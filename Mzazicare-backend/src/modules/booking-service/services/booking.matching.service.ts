/**
 * U-CS 71 — Care Service Booking & Scheduling System
 * Owner(s): Lavin Larry Seme, Arop Mary Abiong
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * Caregiver matching: how a `requested` booking becomes a `confirmed` one.
 *
 *   claim the booking  → status = matching (atomically, on matchAttempts)
 *   ask caregiver-service for approved, available, skilled candidates
 *   drop anyone whose calendar already clashes
 *   rank: distance, then rating, then fewest jobs that day
 *   offer the top 3, 15 minutes to answer  → status = offered
 *   nobody eligible / too many attempts    → status = unassigned, tell a human
 *
 * Plus the expiry sweep, which is the half people forget: without it a
 * booking whose offers all lapse sits in `offered` for ever and nobody is
 * ever told.
 *
 * ============================================================================
 * WHY THE MATCHER CLAIMS BEFORE IT WORKS
 * ============================================================================
 * Matching is triggered by a queue job, and a queue can deliver the same job
 * twice (a retry, a worker restart mid-job, a release that enqueues while an
 * earlier run is still going). Two matchers running against one booking would
 * fan out two sets of offers, and a caregiver would accept a booking that a
 * caregiver had already accepted.
 *
 * So the matcher first CLAIMS the booking: one conditional update, guarded on
 * the `matchAttempts` value it read. The winner's update bumps the counter,
 * which makes the loser's filter stop matching. The loser stops. No locks, no
 * leases, no expiry to get wrong — just the fact that Mongo applies one
 * update to one document at a time.
 */

import logger from "@/shared/config/logger";
import type { GeoPoint } from "@/shared/types";
import { addMinutes, endOfDay, overlaps, startOfDay } from "@/shared/utils/date.util";
import { distanceMeters } from "@/shared/utils/geo.util";
import {
  type Booking,
  type BookingStatus,
  type NewAssignmentOfferInput,
} from "@/modules/booking-service/models/booking.model";
import { bookingRepository } from "@/modules/booking-service/repository/booking.repository";
import { transition } from "@/modules/booking-service/services/booking.state";
import {
  caregiverPort,
  elderPort,
  DependencyUnavailableError,
  type AssignableCaregiver,
} from "@/modules/booking-service/services/booking.dependencies";
import {
  BOOKING_TEMPLATES,
  enqueueMatch,
  notify,
} from "@/modules/booking-service/services/booking.jobs";

// ---------------------------------------------------------------------------
// Matching policy
// ---------------------------------------------------------------------------

/** How long a caregiver has to answer an offer. */
const OFFER_TTL_MINUTES = 15;

/**
 * How many caregivers are offered one booking at a time.
 * Three is a deliberate middle: one offer means a single non-response costs a
 * full 15-minute cycle, while offering everybody turns the roster into a
 * lottery and means two thirds of the platform's caregivers get a 409 for
 * every job. Three gives redundancy without making rejection the norm.
 */
const OFFER_FANOUT = 3;

/** How many candidates to ask caregiver-service for before ranking. */
const CANDIDATE_LIMIT = 12;

/**
 * After this many attempts the booking stops cycling and goes to a human.
 * A booking that three rounds of offers could not staff does not need a
 * fourth; it needs a coordinator to widen the search, move the time, or call
 * the family.
 */
const MAX_MATCH_ATTEMPTS = 3;

/** Offers closed per sweep. Bounded so one pass cannot pull in a whole backlog. */
const EXPIRY_BATCH = 200;

/** The statuses from which a booking may be (re)matched. */
const MATCHABLE: readonly BookingStatus[] = ["requested", "matching", "offered", "unassigned"];

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

type RankedCandidate = {
  caregiver: AssignableCaregiver;
  distance: number;
  rating: number;
  jobsThatDay: number;
};

/**
 * rank — order candidates by the three documented keys, in order.
 * HOW IT WORKS:
 *   1. distance ascending — a caregiver 2km away turns up; one 40km away in
 *      Nairobi traffic is a no-show waiting to happen. An unknown location
 *      sorts last (Infinity) rather than first, so missing data can never
 *      win a tie it did not earn.
 *   2. rating descending — among the near ones, prefer the better reviewed.
 *   3. fewest jobs that day ascending — the tie-breaker that spreads work
 *      across the roster instead of stacking it onto whoever lives closest.
 * Each key only decides when the previous one is level, which is what "rank
 * by distance, then rating, then fewest jobs" actually means.
 */
const rank = (candidates: RankedCandidate[]): RankedCandidate[] =>
  [...candidates].sort(
    (a, b) => a.distance - b.distance || b.rating - a.rating || a.jobsThatDay - b.jobsThatDay,
  );

/**
 * areaOf — the elder's county/estate, if elder-service can tell us.
 * WHY THE CATCH IS NARROW: the area is an enrichment. Distance ranking works
 * without it, so a module that has not shipped that capability must not stop
 * a booking from being staffed — but a REAL failure (a thrown database error,
 * a bug) must still surface, so only the "capability missing" error is
 * tolerated and everything else propagates.
 */
const areaOf = async (elderId: string): Promise<string | null> => {
  try {
    const elder = await elderPort.getById(elderId);
    return elder?.area ?? null;
  } catch (err) {
    if (err instanceof DependencyUnavailableError) return null;
    throw err;
  }
};

export const bookingMatchingService = {
  /**
   * match — staff one booking. Runs on the booking queue.
   * HOW IT WORKS:
   *   1. Load it. A booking that vanished, or has moved on (cancelled,
   *      already confirmed), is not an error — the job is simply stale, so it
   *      returns quietly rather than failing and retrying for ever.
   *   2. If offers are already out and still open, stop. Re-offering a
   *      booking somebody is actively considering is how a caregiver ends up
   *      holding two offers for the same job.
   *   3. CLAIM it (see the file header).
   *   4. Over the attempt cap → `unassigned` and a coordinator is told.
   *   5. Ask caregiver-service for candidates; it applies approval and
   *      availability. We never second-guess that from our own data.
   *   6. Drop clashes, rank, offer the top three, status → `offered`.
   *   7. No candidates → `unassigned` and a coordinator is told.
   */
  match: async (bookingId: string): Promise<Booking | null> => {
    const booking = await bookingRepository.findById(bookingId);
    if (!booking) {
      logger.debug(`[booking] match job for unknown booking ${bookingId}`);
      return null;
    }
    if (!MATCHABLE.includes(booking.status)) {
      logger.debug(`[booking] match job for ${bookingId} ignored — status ${booking.status}`);
      return null;
    }
    if (booking.status === "offered" && (await bookingRepository.offerCountOpen(bookingId)) > 0) {
      logger.debug(`[booking] ${bookingId} already has open offers`);
      return booking;
    }

    // The claim. `from` includes `matching` on purpose: a booking released by
    // a suspension is already in `matching` when the job arrives, so this is
    // a restatement of the same status rather than a lifecycle move. The
    // guard on `matchAttempts` is what actually decides the winner.
    const attempt = booking.matchAttempts ?? 0;
    const claimed = await transition(bookingId, "matching", {
      from: MATCHABLE,
      patch: { matchAttempts: attempt + 1 },
      guard: { matchAttempts: attempt },
    });
    if (!claimed) {
      logger.debug(`[booking] ${bookingId} claimed by another matcher`);
      return null;
    }

    if (claimed.matchAttempts > MAX_MATCH_ATTEMPTS) {
      return bookingMatchingService.giveUp(
        claimed,
        `no caregiver found after ${MAX_MATCH_ATTEMPTS} attempts`,
      );
    }

    const near = claimed.location as unknown as GeoPoint;
    const candidates = await caregiverPort.findAssignable({
      requiredSkills: [...(claimed.requiredSkillsAtBooking ?? [])],
      near,
      area: await areaOf(String(claimed.elderId)),
      scheduledFor: claimed.scheduledFor,
      durationMinutes: claimed.durationMinutes,
      limit: CANDIDATE_LIMIT,
    });

    if (!candidates.length) {
      return bookingMatchingService.giveUp(claimed, "no eligible caregiver");
    }

    // One query for the whole shortlist, then the overlap inequality applied
    // again in memory at the point of the decision. The query already filters
    // by overlap; re-stating it with the shared `overlaps()` helper is how the
    // rule that matters stays visible where it is acted on.
    const clashes = await bookingRepository.findCaregiverClashesIn(
      candidates.map((candidate) => candidate.id),
      claimed.scheduledFor,
      claimed.endsAt,
    );
    const busy = new Set(
      clashes
        .filter((clash) =>
          overlaps(claimed.scheduledFor, claimed.endsAt, clash.scheduledFor, clash.endsAt),
        )
        .map((clash) => String(clash.caregiverId)),
    );

    const free = candidates.filter((candidate) => !busy.has(candidate.id));
    if (!free.length) {
      return bookingMatchingService.giveUp(claimed, "every candidate was already booked");
    }

    const dayStart = startOfDay(claimed.scheduledFor);
    const dayEnd = endOfDay(claimed.scheduledFor);
    const ranked = rank(
      await Promise.all(
        free.map(async (caregiver) => ({
          caregiver,
          distance: caregiver.baseLocation
            ? distanceMeters(caregiver.baseLocation, near)
            : Number.POSITIVE_INFINITY,
          rating: caregiver.ratingAverage ?? 0,
          jobsThatDay: await bookingRepository.countCommittedBetween(
            caregiver.id,
            dayStart,
            dayEnd,
          ),
        })),
      ),
    );

    const shortlist = ranked.slice(0, OFFER_FANOUT);
    const expiresAt = addMinutes(new Date(), OFFER_TTL_MINUTES);
    const offers: NewAssignmentOfferInput[] = shortlist.map(({ caregiver }) => ({
      bookingId: claimed._id,
      caregiverId: caregiver.id as unknown as NewAssignmentOfferInput["caregiverId"],
      expiresAt,
    }));

    await bookingRepository.offerCreateMany(offers);

    // Offers first, then the status. If the family cancelled in between, this
    // transition fails and we close the offers we just wrote — better to
    // withdraw three offers than to leave a cancelled booking looking live to
    // three caregivers' phones.
    const offered = await transition(bookingId, "offered", { from: ["matching"] });
    if (!offered) {
      await bookingRepository.offerExpireAll(bookingId);
      logger.info(`[booking] ${bookingId} moved on while offers were being written`);
      return null;
    }

    await notify({
      template: BOOKING_TEMPLATES.offer,
      audience: { caregiverIds: shortlist.map(({ caregiver }) => caregiver.id) },
      data: {
        bookingId,
        elderId: String(offered.elderId),
        scheduledFor: offered.scheduledFor.toISOString(),
        durationMinutes: offered.durationMinutes,
        expiresAt: expiresAt.toISOString(),
      },
      urgency: "high",
    });

    logger.info(
      `[booking] ${bookingId} offered to ${shortlist.length} caregiver(s), attempt ${claimed.matchAttempts}`,
    );
    return offered;
  },

  /**
   * giveUp — `matching` → `unassigned`, and put it in front of a human.
   * A booking nobody can take is not a failure to hide: it is the one state
   * that needs a person, so the coordinators are notified with the reason.
   */
  giveUp: async (booking: Booking, reason: string): Promise<Booking | null> => {
    const bookingId = String(booking._id);
    const updated = await transition(bookingId, "unassigned", { from: ["matching"] });
    if (!updated) return null;

    await notify({
      template: BOOKING_TEMPLATES.unassigned,
      audience: { roles: ["coordinator"] },
      data: {
        bookingId,
        elderId: String(booking.elderId),
        scheduledFor: booking.scheduledFor.toISOString(),
        reason,
      },
      urgency: "high",
    });

    logger.warn(`[booking] ${bookingId} unassigned — ${reason}`);
    return updated;
  },

  /**
   * expireStaleOffers — the sweep. Runs every minute on the booking queue.
   * HOW IT WORKS:
   *   1. Close every open offer whose deadline has passed, in one update.
   *   2. For each booking those offers belonged to, ask whether ANY open
   *      offer is left (a booking with three offers may have had only one
   *      lapse). If some remain, leave it alone.
   *   3. If none remain and the booking is still `offered`, move it back to
   *      `matching` and enqueue a fresh match. The attempt cap in `match()`
   *      is what eventually ends the cycle at `unassigned`, so the decision
   *      to give up lives in exactly one place.
   *
   * Idempotent throughout: `offerExpireByIds` only touches rows that are
   * still `offered`, and the transition is conditional, so a sweep that runs
   * twice does the work once.
   */
  expireStaleOffers: async (): Promise<{ expired: number; rematched: number }> => {
    const due = await bookingRepository.offerFindDue(new Date(), EXPIRY_BATCH);
    if (!due.length) return { expired: 0, rematched: 0 };

    const expired = await bookingRepository.offerExpireByIds(due.map((offer) => String(offer._id)));

    const affected = [...new Set(due.map((offer) => String(offer.bookingId)))];
    let rematched = 0;

    for (const bookingId of affected) {
      if ((await bookingRepository.offerCountOpen(bookingId)) > 0) continue;

      const back = await transition(bookingId, "matching", { from: ["offered"] });
      if (!back) continue;

      rematched += 1;
      await enqueueMatch(bookingId, { reason: "all offers expired" });
    }

    if (expired) {
      logger.info(`[booking] expired ${expired} offer(s), re-matched ${rematched} booking(s)`);
    }
    return { expired, rematched };
  },
};
