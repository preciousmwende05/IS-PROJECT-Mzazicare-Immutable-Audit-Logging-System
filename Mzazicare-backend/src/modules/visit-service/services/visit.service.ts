/**
 * U-CS 73 — Geo-Verified Visit Tracking System
 * Owner(s): Alvin Kimani, Hezekiah Muiruri Munene
 */

import logger from "@/shared/config/logger";
import { publish } from "@/shared/events/bus";
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableError } from "@/shared/errors";
import type { AuthUser, GeoPoint, Paginated } from "@/shared/types";
import { addMinutes, minutesBetween } from "@/shared/utils/date.util";
import { distanceMeters, toGeoPoint } from "@/shared/utils/geo.util";
import { buildPage, parsePagination } from "@/shared/utils/pagination.util";
import {
  BREACH_CONSECUTIVE_PINGS,
  LATE_CHECKIN_MINUTES,
  MAX_PLAUSIBLE_DISTANCE_METERS,
  MISSED_GRACE_MINUTES,
  MISSED_SWEEP_BATCH_SIZE,
  MISSED_SWEEP_MAX_BATCHES,
  OFFLINE_EARLIEST_MINUTES_BEFORE,
  SHORT_VISIT_RATIO,
} from "@/modules/visit-service/services/visit.constants";
import {
  caregiverIdForUser,
  elderIdsForUser,
  registerCaregiverDirectory,
  registerFamilyDirectory,
} from "@/modules/visit-service/services/visit.directory";
import {
  visitRepository,
  type NewVisitSeed,
  type VisitPatch,
  type VisitFilter,
} from "@/modules/visit-service/repository/visit.repository";
import type {
  LocationPing,
  VerificationFlag,
  Visit,
  VisitStatus,
} from "@/modules/visit-service/models/visit.model";
import type {
  CheckInInput,
  CheckOutInput,
  DisputeInput,
  FlaggedVisitsQuery,
  ListVisitsQuery,
  PingInput,
  ResolveDisputeInput,
} from "@/modules/visit-service/validation/visit.validation";
import { bookingConfirmedPayload } from "@/modules/visit-service/validation/visit.events";

type Actor = AuthUser;
type PageQuery = { page?: unknown; limit?: unknown };

export type LocationVerification = {
  /** Distance in metres from the expected point*/
  distance: number;
  /** Whether inside the fence and not reported as a mock location. */
  verified: boolean;
  /** Why it is not verified. Empty if verified*/
  flags: VerificationFlag[];
};

/**
 * inside the radius is marked as verified while outside the radius up to 1 000 is allowed,
 * but flagged `outside_geofence`and beyond 1 000 m is considered being in the wrong place
 *
 * @throws UnprocessableError when the point is beyond the given limit
 */
export const verifyLocation = (
  actual: GeoPoint,
  expected: GeoPoint,
  radiusMeters: number,
  isMockLocation = false,
): LocationVerification => {
  const exact = distanceMeters(actual, expected);

  if (!Number.isFinite(exact)) {
    throw new UnprocessableError("Location could not be measured");
  }

  if (exact > MAX_PLAUSIBLE_DISTANCE_METERS) {
    throw new UnprocessableError(
      `Location is ${Math.round(exact)} m from the visit address — too far to be a genuine check`,
      { distanceMeters: Math.round(exact), maxMeters: MAX_PLAUSIBLE_DISTANCE_METERS },
    );
  }

  const withinRadius = exact <= radiusMeters;
  const flags: VerificationFlag[] = [];
  if (!withinRadius) flags.push("outside_geofence");
  if (isMockLocation) flags.push("mock_location");

  return {
    distance: Math.round(exact * 10) / 10,
    verified: withinRadius && !isMockLocation,
    flags,
  };
};

const isStaff = (actor: Actor) => actor.role === "coordinator" || actor.role === "admin";

const assertStaff = (actor: Actor) => {
  if (!isStaff(actor)) throw new ForbiddenError("Coordinator access required");
};

/**
 * Staff see everything. A caregiver sees the visits assigned to them; a family
 * or elder user sees the visits of the elders they may act for. Anyone else
 * sees nothing.
 */
const canSee = async (visit: Visit, actor: Actor): Promise<boolean> => {
  if (isStaff(actor)) return true;

  if (actor.role === "caregiver") {
    return (await caregiverIdForUser(actor.id)) === String(visit.caregiverId);
  }

  if (actor.role === "family" || actor.role === "elder") {
    return (await elderIdsForUser(actor.id)).includes(String(visit.elderId));
  }

  return false;
};

/** The visit filter that confines a caller to the visits they may see. `null` = none. */
const scopeFor = async (actor: Actor): Promise<VisitFilter | null> => {
  if (isStaff(actor)) return {};

  if (actor.role === "caregiver") {
    const caregiverId = await caregiverIdForUser(actor.id);
    return caregiverId ? { caregiverId } : null;
  }

  if (actor.role === "family" || actor.role === "elder") {
    const elderIds = await elderIdsForUser(actor.id);
    return elderIds.length ? { elderIds } : null;
  }

  return null;
};

const emptyPage = (query: PageQuery): Paginated<Visit> => {
  const { page, limit } = parsePagination(query);
  return buildPage<Visit>([], 0, page, limit);
};

const pageOf = async (filter: VisitFilter, query: PageQuery): Promise<Paginated<Visit>> => {
  const { page, limit, skip } = parsePagination(query);
  const [items, total] = await visitRepository.findPage(filter, skip, limit);
  return buildPage(items, total, page, limit);
};

const IN_PROGRESS: VisitStatus[] = ["checked_in", "in_progress"];
const AWAITING_ARRIVAL: VisitStatus[] = ["scheduled", "en_route"];

/** A visit the caller may not see is a 404, not a 403: whether it exists is not theirs to learn. */
const findVisible = async (visitId: string, actor: Actor): Promise<Visit> => {
  const visit = await visitRepository.findById(visitId);
  if (!visit || !(await canSee(visit, actor))) throw new NotFoundError("Visit");
  return visit;
};

/** `canSee` already confines a caregiver to their own visits; this keeps everyone else out. */
const findForCaregiver = async (visitId: string, actor: Actor): Promise<Visit> => {
  const visit = await findVisible(visitId, actor);
  if (actor.role !== "caregiver") {
    throw new ForbiddenError("Only the assigned caregiver can do this");
  }
  return visit;
};

/** Stored GeoJSON is typed loosely by Mongoose; a malformed point measures as NaN. */
const pointOf = (stored: { coordinates: number[] }): GeoPoint => ({
  type: "Point",
  coordinates: [stored.coordinates[0] ?? NaN, stored.coordinates[1] ?? NaN],
});

const withFlags = (existing: readonly VerificationFlag[], added: VerificationFlag[]) => [
  ...new Set([...existing, ...added]),
];

/**
 * Check-in/out location is optional (spec: "just a button, optional location").
 * With one: the usual geofence check. Without one: accepted, never verified,
 * flagged `no_location` so a coordinator can see it.
 */
const checkOptionalLocation = (
  input: { latitude?: number; longitude?: number; isMockLocation: boolean },
  visit: Visit,
): { location?: GeoPoint; check: Omit<LocationVerification, "distance"> & { distance?: number } } => {
  if (input.latitude === undefined || input.longitude === undefined) {
    return { check: { verified: false, flags: ["no_location"] } };
  }
  const location = toGeoPoint(input.latitude, input.longitude);
  return {
    location,
    check: verifyLocation(location, pointOf(visit.expectedLocation), visit.geofenceRadiusMeters, input.isMockLocation),
  };
};

/**
 * When a client sent an offline check-in, its timestamp is used — but only
 * inside the booking window. Otherwise the server clock decides.
 */
const checkInTime = (visit: Visit, offlineRecordedAt: Date | undefined, now: Date): Date => {
  if (!offlineRecordedAt) return now;

  const earliest = addMinutes(visit.scheduledFor, -OFFLINE_EARLIEST_MINUTES_BEFORE);
  const latest = addMinutes(visit.scheduledFor, visit.expectedDurationMinutes);
  if (offlineRecordedAt < earliest || offlineRecordedAt > latest) {
    throw new UnprocessableError("Offline check-in time is outside the booking window", {
      offlineRecordedAt: offlineRecordedAt.toISOString(),
      earliest: earliest.toISOString(),
      latest: latest.toISOString(),
    });
  }
  // validation allows a few minutes of client clock skew; never record the future
  return offlineRecordedAt > now ? now : offlineRecordedAt;
};

/**
 * A state change nobody hears about leaves booking and billing behind. When the
 * event cannot be published, put the visit back and rethrow so the caller retries.
 */
const revertUnannounced = async (
  before: Visit,
  from: VisitStatus[],
  set: VisitPatch,
  unset: (keyof Visit)[],
  event: string,
  err: unknown,
): Promise<never> => {
  const visitId = String(before._id);
  logger.error(
    `[visit] visit ${visitId}: ${event} could not be published ` +
      `(${err instanceof Error ? err.message : String(err)}); rolling the visit back`,
  );
  const restored = await visitRepository.transition(
    visitId,
    from,
    { status: before.status, verificationFlags: before.verificationFlags, ...set },
    unset,
  );
  if (!restored) {
    logger.error(`[visit] visit ${visitId} could NOT be rolled back: ${event} was never announced`);
  }
  throw err;
};

// The service

export const visitService = {
  /** GET /:id — the access-checked read. */
  getById: findVisible,

  /** GET / — the caller's own visits, narrowed by status and date. */
  list: async (query: ListVisitsQuery, actor: Actor): Promise<Paginated<Visit>> => {
    const scope = await scopeFor(actor);
    if (!scope) return emptyPage(query);

    return pageOf(
      {
        ...scope,
        ...(query.status && { statuses: [query.status] }),
        ...(query.from && { scheduledFrom: query.from }),
        ...(query.to && { scheduledTo: query.to }),
      },
      query,
    );
  },

  /** GET /active — coordinator: every visit in progress right now. */
  listActive: async (query: PageQuery, actor: Actor): Promise<Paginated<Visit>> => {
    assertStaff(actor);
    return pageOf({ statuses: IN_PROGRESS }, query);
  },

  /** GET /flagged — coordinator: visits carrying verification flags. */
  listFlagged: async (query: FlaggedVisitsQuery, actor: Actor): Promise<Paginated<Visit>> => {
    assertStaff(actor);
    return pageOf(query.flag ? { flag: query.flag } : { flagged: true }, query);
  },

  // Caregiver actions

  /** POST /:id/en-route — the caregiver has set off. */
  markEnRoute: async (visitId: string, actor: Actor): Promise<Visit> => {
    const visit = await findForCaregiver(visitId, actor);
    if (visit.status !== "scheduled") {
      throw new ConflictError(`Visit is ${visit.status}, not scheduled`);
    }

    const updated = await visitRepository.transition(visitId, ["scheduled"], {
      status: "en_route",
    });
    if (!updated) throw new ConflictError("Visit changed while marking it en route; try again");
    return updated;
  },

  /**
   * POST /:id/check-in — geo-verified. Slightly outside the fence or a mock
   * location is flagged for review; implausibly far is rejected by verifyLocation.
   */
  checkIn: async (visitId: string, input: CheckInInput, actor: Actor): Promise<Visit> => {
    const visit = await findForCaregiver(visitId, actor);
    if (!AWAITING_ARRIVAL.includes(visit.status)) {
      throw new ConflictError(`Visit is already ${visit.status}`);
    }

    const { location, check } = checkOptionalLocation(input, visit);

    const checkInAt = checkInTime(visit, input.offlineRecordedAt, new Date());
    const flags = [...check.flags];
    if (input.offlineRecordedAt) flags.push("offline_sync");
    if (checkInAt > addMinutes(visit.scheduledFor, LATE_CHECKIN_MINUTES))
      flags.push("late_checkin");

    const updated = await visitRepository.transition(visitId, AWAITING_ARRIVAL, {
      status: "checked_in",
      checkInAt,
      checkInLocation: location,
      checkInDistanceMeters: check.distance,
      checkInVerified: check.verified,
      verificationFlags: withFlags(visit.verificationFlags, flags),
    });
    if (!updated) throw new ConflictError("Visit changed while checking in; try again");

    try {
      await publish("visit.checked_in", {
        visitId,
        bookingId: String(updated.bookingId),
        caregiverId: String(updated.caregiverId),
        verified: check.verified,
      });
    } catch (err) {
      await revertUnannounced(
        visit,
        IN_PROGRESS,
        { checkInVerified: false },
        ["checkInAt", "checkInLocation", "checkInDistanceMeters"],
        "visit.checked_in",
        err,
      );
    }

    return updated;
  },

  /**
   * POST /:id/ping — a ping is evidence, so it is stored wherever it is. Two in a
   * row outside the fence publish one breach warning; nothing is auto-failed.
   */
  ping: async (visitId: string, input: PingInput, actor: Actor): Promise<void> => {
    const visit = await findForCaregiver(visitId, actor);
    if (!IN_PROGRESS.includes(visit.status)) {
      throw new ConflictError(`Visit is ${visit.status}; pings are only taken during a visit`);
    }

    await visitRepository.createPing({
      visitId: visit._id,
      location: toGeoPoint(input.latitude, input.longitude),
      recordedAt: input.recordedAt,
      accuracyMeters: input.accuracyMeters,
      isMockLocation: input.isMockLocation,
    });

    // first ping after check-in; losing the race to another ping is fine
    if (visit.status === "checked_in") {
      await visitRepository.transition(visitId, ["checked_in"], { status: "in_progress" });
    }

    const expected = pointOf(visit.expectedLocation);
    const recent = await visitRepository.findRecentPings(visitId, BREACH_CONSECUTIVE_PINGS + 1);
    const distances = recent.map((p) => distanceMeters(pointOf(p.location), expected));
    const outside = distances.map((d) => d > visit.geofenceRadiusMeters);

    // only the ping that completes the run announces it, not every ping after
    const breached =
      outside.length >= BREACH_CONSECUTIVE_PINGS &&
      outside.slice(0, BREACH_CONSECUTIVE_PINGS).every(Boolean) &&
      !outside[BREACH_CONSECUTIVE_PINGS];
    if (!breached) return;

    try {
      await publish("visit.geofence.breached", {
        visitId,
        distanceMeters: Math.round(distances[0] ?? 0),
      });
    } catch (err) {
      // The ping is stored. Failing it would make the app resend it, and the
      // resent ping would no longer complete the run, so the warning is lost.
      logger.error(
        `[visit] visit ${visitId}: visit.geofence.breached could not be published ` +
          `(${err instanceof Error ? err.message : String(err)})`,
      );
    }
  },

  /** POST /:id/check-out — same two-tier location rule; the duration billed is the actual one. */
  checkOut: async (visitId: string, input: CheckOutInput, actor: Actor): Promise<Visit> => {
    const visit = await findForCaregiver(visitId, actor);
    if (!IN_PROGRESS.includes(visit.status) || !visit.checkInAt) {
      throw new ConflictError(`Visit is ${visit.status}; only a checked-in visit can check out`);
    }

    const { location, check } = checkOptionalLocation(input, visit);

    const now = new Date();
    const actualDurationMinutes = Math.max(0, minutesBetween(visit.checkInAt, now));
    const flags = [...check.flags];
    if (actualDurationMinutes < visit.expectedDurationMinutes * SHORT_VISIT_RATIO) {
      flags.push("short_visit");
    }

    const updated = await visitRepository.transition(visitId, IN_PROGRESS, {
      status: "checked_out",
      checkOutAt: now,
      checkOutLocation: location,
      checkOutDistanceMeters: check.distance,
      checkOutVerified: check.verified,
      actualDurationMinutes,
      verificationFlags: withFlags(visit.verificationFlags, flags),
    });
    if (!updated) throw new ConflictError("Visit changed while checking out; try again");

    try {
      await publish("visit.checked_out", { visitId, durationMinutes: actualDurationMinutes });
    } catch (err) {
      await revertUnannounced(
        visit,
        ["checked_out"],
        { checkOutVerified: false },
        ["checkOutAt", "checkOutLocation", "checkOutDistanceMeters", "actualDurationMinutes"],
        "visit.checked_out",
        err,
      );
    }

    return updated;
  },

  // Tracking and disputes

  /** GET /:id/track — the caregiver's last known position while the visit is on. */
  track: async (
    visitId: string,
    actor: Actor,
  ): Promise<{ visit: Visit; lastPing: LocationPing | null }> => {
    const visit = await findVisible(visitId, actor);
    if (!IN_PROGRESS.includes(visit.status)) {
      throw new ConflictError(`Visit is ${visit.status}; it can only be tracked while in progress`);
    }

    const [lastPing] = await visitRepository.findRecentPings(visitId, 1);
    return { visit, lastPing: lastPing ?? null };
  },

  /** POST /:id/dispute — the family challenges a checked-out visit. Its pings become evidence. */
  dispute: async (visitId: string, input: DisputeInput, actor: Actor): Promise<Visit> => {
    if (actor.role !== "family" && actor.role !== "elder") {
      throw new ForbiddenError("Only the family can dispute a visit");
    }
    const visit = await findVisible(visitId, actor);
    if (visit.status !== "checked_out") {
      throw new ConflictError(`Visit is ${visit.status}; only a checked-out visit can be disputed`);
    }

    // before the status flips, so the TTL can never take evidence from an open dispute
    await visitRepository.holdPingsForDispute(visitId);

    const updated = await visitRepository.transition(visitId, ["checked_out"], {
      status: "disputed",
      disputeReason: input.reason,
    });
    if (!updated) throw new ConflictError("Visit changed while disputing it; try again");
    return updated;
  },

  /** POST /:id/resolve-dispute — coordinator upholds (completed) or voids it. */
  resolveDispute: async (
    visitId: string,
    input: ResolveDisputeInput,
    actor: Actor,
  ): Promise<Visit> => {
    assertStaff(actor);
    const visit = await findVisible(visitId, actor);
    if (visit.status !== "disputed") {
      throw new ConflictError(`Visit is ${visit.status}, not disputed`);
    }

    const updated = await visitRepository.transition(visitId, ["disputed"], {
      status: input.resolution === "uphold" ? "completed" : "voided",
    });
    if (!updated) throw new ConflictError("Visit changed while resolving the dispute; try again");
    return updated;
  },

  getElderIdForVisit: async (visitId: string): Promise<string | null> =>
    /^[a-f\d]{24}$/i.test(visitId) ? visitRepository.findElderIdById(visitId) : null,

  createForBooking: async (seed: NewVisitSeed): Promise<{ visit: Visit; created: boolean }> => {
    const { visit, created } = await visitRepository.createOnce(seed);
    if (created) return { visit, created };

    if (String(visit.caregiverId) !== seed.caregiverId) {
      const reassigned = await visitRepository.transitionByBookingId(
        seed.bookingId,
        ["scheduled", "en_route"],
        { caregiverId: seed.caregiverId, status: "scheduled" },
      );
      if (reassigned) {
        logger.info(
          `[visit] booking ${seed.bookingId}: visit passed to caregiver ${seed.caregiverId}`,
        );
        return { visit: reassigned, created };
      }
      logger.warn(
        `[visit] booking ${seed.bookingId}: caregiver changed but visit is ${visit.status}; left as is`,
      );
    }

    return { visit, created };
  },

  handleBookingConfirmed: async (payload: unknown): Promise<void> => {
    const parsed = bookingConfirmedPayload.safeParse(payload);

    if (!parsed.success) {
      const bookingId = (payload as { bookingId?: unknown } | null)?.bookingId;
      logger.error(
        `[visit] booking.confirmed for booking ${String(bookingId)} cannot create a visit — ` +
          `payload is missing or malformed: ${parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ")}`,
      );
      return;
    }

    const event = parsed.data;
    const { visit, created } = await visitService.createForBooking({
      bookingId: event.bookingId,
      caregiverId: event.caregiverId,
      elderId: event.elderId,
      expectedLocation: event.location,
      scheduledFor: event.scheduledFor,
      expectedDurationMinutes: event.durationMinutes,
    });

    if (created) logger.info(`[visit] booking ${event.bookingId}: visit created`);
    // Announced every time (idempotent), so a lost first message is repaired by a
    // redelivery: booking-service stamps the visitId the caregiver needs to check in.
    await publish("visit.scheduled", { visitId: String(visit._id), bookingId: event.bookingId });
  },

  sweepMissed: async (
    now: Date = new Date(),
    graceMinutes: number = MISSED_GRACE_MINUTES,
  ): Promise<{ missed: number; failed: number }> => {
    const seen: string[] = [];
    let missed = 0;
    let failed = 0;

    for (let round = 0; round < MISSED_SWEEP_MAX_BATCHES; round++) {
      const due = await visitRepository.findDueForMissedSweep(
        graceMinutes,
        now,
        MISSED_SWEEP_BATCH_SIZE,
        seen,
      );
      if (!due.length) break;

      for (const visit of due) {
        const visitId = String(visit._id);
        seen.push(visitId);

        const flipped = await visitRepository.transition(visitId, ["scheduled", "en_route"], {
          status: "missed",
        });
        if (!flipped) continue; // someone else got it, or the caregiver just arrived

        try {
          await publish("visit.missed", { visitId, bookingId: String(flipped.bookingId) });
          missed++;
        } catch (err) {
          failed++;
          logger.error(
            `[visit] visit ${visitId} flipped to missed but visit.missed could not be published ` +
              `(${err instanceof Error ? err.message : String(err)}); putting it back for the next sweep`,
          );
          const restored = await visitRepository.transition(visitId, ["missed"], {
            status: visit.status,
          });
          if (!restored) {
            logger.error(
              `[visit] visit ${visitId} could NOT be put back: it is missed and was never announced`,
            );
          }
        }
      }
    }

    return { missed, failed };
  },

  registerCaregiverDirectory,

  registerFamilyDirectory,
};
