/**
 * U-CS 72 — Priority Emergency Handling & Escalation System
 * Owner(s): Wyclef Wasike Tavasi
 *
 * Every business rule for U-CS 72 lives here. No express types in this file:
 * everything is callable from a controller, the worker or a script alike.
 *
 * Who may do what (route guards check the role; this file checks the relationship):
 *
 *   raise          elder, family, caregiver with a link to the elder (fails OPEN if unverifiable)
 *   panic          elder with a link to the elder; always critical
 *   see            staff, raiser, claimer, anyone the system notified, or the elder's circle
 *   acknowledge    anyone who can see it, EXCEPT the raiser (fails CLOSED)
 *   respond        only the acknowledger
 *   resolve        the acknowledger/responder, or staff. A note is mandatory.
 *   false alarm    raiser within the grace window, the claimer, or staff
 *   escalate       staff, while unclaimed (skips the timer)
 *   policies       admin
 *
 * The ladder: level 0 fires on creation; each later level is a DELAYED job
 * timed from when the emergency was raised. Every job re-checks the
 * emergency before acting (see handleDispatchJob), so acknowledgement never
 * has to cancel a timer to be correct. Cancelling is only tidiness.
 */

import logger from "@/shared/config/logger";
import { ConflictError, ForbiddenError, NotFoundError } from "@/shared/errors";
import { publish } from "@/shared/events/bus";
import { emergencyQueue } from "@/shared/queues";
import type { AuthUser, GeoPoint, Paginated, Role } from "@/shared/types";
import { toGeoPoint } from "@/shared/utils/geo.util";
import { buildPage, parsePagination } from "@/shared/utils/pagination.util";
import {
  ACTIVE_STATUSES,
  EMERGENCY_SEVERITIES,
  SEVERITY_RANK,
  UNCLAIMED_STATUSES,
  type Emergency,
  type EmergencyRaisedVia,
  type EmergencySeverity,
  type EmergencyStatus,
  type EmergencyType,
  type EscalationStep,
  type EscalationTrigger,
} from "@/modules/emergency-service/models/emergency.model";
import { emergencyRepository } from "@/modules/emergency-service/repository/emergency.repository";
import { emergencyDeps } from "@/modules/emergency-service/services/emergency.dependencies";
import {
  escalationPolicy,
  type ResolvedPolicy,
} from "@/modules/emergency-service/services/emergency.policy";
import {
  dispatchLevel,
  notifyInvolved,
} from "@/modules/emergency-service/services/emergency.targets";
import type {
  EscalateEmergencyInput,
  FalseAlarmInput,
  ListEmergenciesQuery,
  PanicInput,
  RaiseEmergencyInput,
  ResolveEmergencyInput,
  UpdatePolicyInput,
} from "@/modules/emergency-service/validation/emergency.validation";

type Actor = AuthUser;

/** How long the person who raised an alert may cancel it themselves. */
export const FALSE_ALARM_GRACE_SECONDS = 60;

/** The job the emergency worker drains. One code path fires every level, including level 0. */
export type DispatchLevelJob = {
  emergencyId: string;
  level: number;
  trigger: EscalationTrigger;
  triggeredBy: string | null;
  /** Free text from a coordinator's manual escalation. */
  reason?: string | null;
};
export const DISPATCH_LEVEL_JOB = "dispatch-level";

const RAISED_VIA_BY_ROLE: Partial<Record<Role, EmergencyRaisedVia>> = {
  elder: "panic_button",
  family: "family",
  caregiver: "caregiver",
};

const isStaff = (role: Role) => role === "coordinator" || role === "admin";
const same = (id: unknown, userId: string) => Boolean(id) && String(id) === userId;
const isUnclaimed = (status: string) => UNCLAIMED_STATUSES.includes(status as EmergencyStatus);

/** When a level is due: `afterSeconds` from the moment the emergency was raised. */
const dueAt = (raisedAt: Date, afterSeconds: number) =>
  new Date(raisedAt.getTime() + afterSeconds * 1000);

/** Side work after the record is saved. Logged on failure, never thrown. */
const bestEffort = async (label: string, work: () => Promise<unknown>): Promise<void> => {
  try {
    await work();
  } catch (err) {
    logger.error(`[emergency] ${label} failed: ${(err as Error).message}`);
  }
};

/** The 409 for a transition that lost a race or arrived too late. */
const conflictFor = async (id: string, attempted: string): Promise<never> => {
  const current = await emergencyRepository.findById(id);
  const status = current?.status;
  if (status === "resolved" || status === "false_alarm") {
    throw new ConflictError(`This emergency is already closed (${status})`);
  }
  throw new ConflictError(`Cannot ${attempted}: the emergency is ${status ?? "unavailable"}`);
};

/**
 * Load an emergency for someone allowed to see it, or 404. Never 403: a 403
 * would confirm the emergency exists. An unverifiable relationship fails
 * CLOSED here.
 */
const loadForActor = async (id: string, actor: Actor): Promise<Emergency> => {
  const emergency = await emergencyRepository.findById(id);
  if (!emergency) throw new NotFoundError("Emergency");

  if (isStaff(actor.role)) return emergency;
  if (
    [emergency.raisedBy, emergency.acknowledgedBy, emergency.respondingUserId].some((u) =>
      same(u, actor.id),
    )
  ) {
    return emergency;
  }
  // If the system told you about it, you may see it and act on it.
  if (await emergencyRepository.wasNotified(id, actor.id)) return emergency;

  const access = await emergencyDeps().elder.checkAccess(String(emergency.elderId), actor);
  if (access.decision === "allowed") return emergency;
  throw new NotFoundError("Emergency");
};

/** Put a level on the emergency queue. A due-now level falls back to firing inline if Redis is down. */
const scheduleLevel = async (job: DispatchLevelJob, delayMs: number): Promise<void> => {
  try {
    await emergencyQueue.add(DISPATCH_LEVEL_JOB, job, { delay: delayMs });
  } catch (err) {
    logger.error(
      `[emergency] could not queue L${job.level} for ${job.emergencyId}: ${(err as Error).message}`,
    );
    if (delayMs === 0) {
      await bestEffort("inline dispatch", () => emergencyService.handleDispatchJob(job));
    }
  }
};

/**
 * Queue the rung after `fromLevel` and record when it is due. At the top of
 * the ladder, clears nextEscalationAt instead. The timestamp is only written
 * while the emergency is still unclaimed.
 */
const scheduleFollowing = async (
  emergency: Emergency,
  policy: ResolvedPolicy,
  fromLevel: number,
): Promise<void> => {
  const id = String(emergency._id);
  const next = policy.levels.find((l) => l.level === fromLevel + 1);
  if (!next) {
    await emergencyRepository.transition(id, UNCLAIMED_STATUSES, { nextEscalationAt: null });
    return;
  }
  const at = dueAt(emergency.createdAt, next.afterSeconds);
  await emergencyRepository.transition(id, UNCLAIMED_STATUSES, { nextEscalationAt: at });
  await scheduleLevel(
    { emergencyId: id, level: next.level, trigger: "timer", triggeredBy: null },
    Math.max(0, at.getTime() - Date.now()),
  );
};

/**
 * Remove this emergency's delayed escalation jobs. Optional tidiness: if it
 * fails, those jobs still fire, find the emergency claimed or closed, and do
 * nothing.
 */
const cancelPendingEscalations = async (emergencyId: string): Promise<void> => {
  const delayed = await emergencyQueue.getJobs(["delayed"]);
  const mine = delayed.filter(
    (job) => (job?.data as DispatchLevelJob | undefined)?.emergencyId === emergencyId,
  );
  await Promise.all(mine.map((job) => job.remove()));
  if (mine.length) {
    logger.info(`[emergency] ${emergencyId} cancelled ${mine.length} pending escalation(s)`);
  }
};

type RaiseCommand = {
  elderId: string;
  type: EmergencyType;
  severity: EmergencySeverity;
  description?: string;
  location?: { latitude: number; longitude: number };
  activeBookingId?: string;
  raisedVia: EmergencyRaisedVia;
};

/** Everything needed to open an emergency, whoever (or whatever) raised it. */
type OpenCommand = RaiseCommand & {
  raisedBy: string | null;
  raiserVerified: boolean;
  /** Used when the report carries no location, e.g. the elder's home. */
  fallbackLocation: GeoPoint | null;
  sourceKey: string | null;
};

export type RaiseResult = { emergency: Emergency; collapsed: boolean };

/**
 * A report on an elder that already has an open emergency. Counted, severity
 * raised if the new report is worse, and whoever is handling it is told.
 * Never rejected and never silent.
 */
const collapseInto = async (
  existing: Emergency,
  severity: EmergencySeverity,
  actorId: string | null,
): Promise<RaiseResult> => {
  const id = String(existing._id);
  const rank = SEVERITY_RANK[severity];
  const raiseTo = rank > existing.severityRank ? { severity, severityRank: rank } : undefined;
  const updated = (await emergencyRepository.recordPress(id, new Date(), raiseTo)) ?? existing;

  // A worse report can make the next rung due sooner. Queue it at the new
  // time; whichever job fires first climbs, and the other finds nothing to do.
  if (raiseTo && isUnclaimed(updated.status)) {
    await bestEffort("reschedule after severity rise", async () => {
      const policy = await escalationPolicy.forSeverity(raiseTo.severity);
      const next = policy.levels.find((l) => l.level === updated.escalationLevel + 1);
      if (!next) return;
      const at = dueAt(updated.createdAt, next.afterSeconds);
      if (updated.nextEscalationAt && updated.nextEscalationAt <= at) return;
      await emergencyRepository.transition(id, UNCLAIMED_STATUSES, { nextEscalationAt: at });
      updated.nextEscalationAt = at;
      await scheduleLevel(
        { emergencyId: id, level: next.level, trigger: "timer", triggeredBy: null },
        Math.max(0, at.getTime() - Date.now()),
      );
    });
  }

  if (updated.acknowledgedBy) {
    await bestEffort("notify claimer of repeat press", () =>
      notifyInvolved(
        updated,
        `Raised again (${updated.pressCount} times in total). Still ${updated.status}.`,
        actorId,
      ),
    );
  }
  logger.info(
    `[emergency] ${id} pressed again (${updated.pressCount})${raiseTo ? `, severity now ${raiseTo.severity}` : ""}`,
  );
  return { emergency: updated, collapsed: true };
};

/**
 * Open a new emergency, or collapse into the elder's open one. Queues level 0
 * and level 1, publishes emergency.raised, and returns without waiting for
 * anyone to be notified.
 */
const openOrCollapse = async (command: OpenCommand): Promise<RaiseResult> => {
  const existing = await emergencyRepository.findOpenForElder(command.elderId);
  if (existing) return collapseInto(existing, command.severity, command.raisedBy);

  const now = new Date();
  const policy = await escalationPolicy.forSeverity(command.severity);
  const firstRung = policy.levels.find((l) => l.level === 1);

  const created = await emergencyRepository.create({
    elderId: command.elderId,
    raisedBy: command.raisedBy,
    raisedVia: command.raisedVia,
    type: command.type,
    severity: command.severity,
    severityRank: SEVERITY_RANK[command.severity],
    description: command.description ?? null,
    location: command.location
      ? toGeoPoint(command.location.latitude, command.location.longitude)
      : command.fallbackLocation,
    activeBookingId: command.activeBookingId ?? null,
    raiserVerified: command.raiserVerified,
    lastPressedAt: now,
    nextEscalationAt: firstRung ? dueAt(now, firstRung.afterSeconds) : null,
    sourceKey: command.sourceKey,
  });

  if (!created) {
    // Either this source event already raised one, or a simultaneous report
    // won the race to open the elder's emergency.
    if (command.sourceKey) {
      const already = await emergencyRepository.findBySourceKey(command.sourceKey);
      if (already) return { emergency: already, collapsed: true };
    }
    const winner = await emergencyRepository.findOpenForElder(command.elderId);
    if (winner) return collapseInto(winner, command.severity, command.raisedBy);
    throw new ConflictError("Could not open the emergency, please try again");
  }

  const emergencyId = String(created._id);
  // Enqueue and return. Level 1 is queued now as well, so it does not depend
  // on level 0 succeeding.
  await scheduleLevel({ emergencyId, level: 0, trigger: "initial", triggeredBy: null }, 0);
  if (firstRung && created.nextEscalationAt) {
    await scheduleLevel(
      { emergencyId, level: 1, trigger: "timer", triggeredBy: null },
      Math.max(0, created.nextEscalationAt.getTime() - Date.now()),
    );
  }
  await bestEffort("publish emergency.raised", () =>
    publish("emergency.raised", {
      emergencyId,
      elderId: command.elderId,
      severity: command.severity,
    }),
  );

  return { emergency: created, collapsed: false };
};

/** A person raising an alert: check their link to the elder first (fails OPEN). */
const raise = async (command: RaiseCommand, actor: Actor): Promise<RaiseResult> => {
  const access = await emergencyDeps().elder.checkAccess(command.elderId, actor);
  if (access.decision === "denied") throw new NotFoundError("Elder");
  if (access.decision === "unknown") {
    // Fail OPEN: create it anyway, flagged, rather than ignore a real emergency.
    logger.warn(
      `[emergency] ${actor.role} ${actor.id} raising for elder ${command.elderId} unverified: ${access.reason}`,
    );
  }

  return openOrCollapse({
    ...command,
    raisedBy: actor.id,
    raiserVerified: access.decision === "allowed",
    fallbackLocation: access.decision === "allowed" ? access.elder.homeLocation : null,
    sourceKey: null,
  });
};

/**
 * The system raising an alert from another module's event. No person, so
 * no access check. At most one emergency per source event: a re-delivered
 * event finds the first one and stops.
 */
const raiseAutomatically = async (
  command: Omit<RaiseCommand, "raisedVia"> & { sourceKey: string },
): Promise<void> => {
  if (await emergencyRepository.findBySourceKey(command.sourceKey)) {
    logger.info(`[emergency] ${command.sourceKey} already handled`);
    return;
  }
  const { emergency, collapsed } = await openOrCollapse({
    ...command,
    raisedVia: "auto_detected",
    raisedBy: null,
    raiserVerified: true,
    fallbackLocation: null,
  });
  logger.info(
    `[emergency] ${command.sourceKey} ${collapsed ? "joined open emergency" : "raised"} ${String(emergency._id)} (${emergency.severity})`,
  );
};

/** Which of the event's lookups failed, for the log. Expected while other modules are unbuilt. */
const skipAutomatic = (sourceKey: string, reason: string): void => {
  logger.warn(`[emergency] ${sourceKey} not raised: ${reason}`);
};

export const emergencyService = {
  /** POST / */
  raise: (input: RaiseEmergencyInput, actor: Actor): Promise<RaiseResult> =>
    raise({ ...input, raisedVia: RAISED_VIA_BY_ROLE[actor.role] ?? "family" }, actor),

  /** POST /panic. Nothing is known yet except who and where, so assume the worst. */
  panic: (input: PanicInput, actor: Actor): Promise<RaiseResult> =>
    raise(
      {
        elderId: input.elderId,
        location: input.location,
        type: "other",
        severity: "critical",
        raisedVia: "panic_button",
      },
      actor,
    ),

  /** GET /. The coordinators' live queue. */
  list: async (query: ListEmergenciesQuery): Promise<Paginated<Emergency>> => {
    const { page, limit, skip } = parsePagination(query);
    const [items, total] = await emergencyRepository.findQueuePage(
      { status: query.status, severity: query.severity },
      skip,
      limit,
    );
    return buildPage(items, total, page, limit);
  },

  /** GET /:id, with the escalation trail. */
  getDetail: async (
    id: string,
    actor: Actor,
  ): Promise<{ emergency: Emergency; steps: EscalationStep[] }> => {
    const emergency = await loadForActor(id, actor);
    const steps = await emergencyRepository.findSteps(id);
    return { emergency, steps };
  },

  /** POST /:id/acknowledge. Claims it and stops the ladder. */
  acknowledge: async (id: string, actor: Actor): Promise<Emergency> => {
    const emergency = await loadForActor(id, actor);
    if (same(emergency.raisedBy, actor.id)) {
      throw new ForbiddenError("Someone other than the person who raised it must acknowledge it");
    }

    const updated = await emergencyRepository.transition(id, UNCLAIMED_STATUSES, {
      status: "acknowledged",
      acknowledgedBy: actor.id,
      acknowledgedAt: new Date(),
      nextEscalationAt: null,
    });
    if (!updated) return conflictFor(id, "acknowledge");

    await bestEffort("cancel pending escalations", () => cancelPendingEscalations(id));
    await bestEffort("mark trail acknowledged", () =>
      emergencyRepository.markStepsAcknowledged(id),
    );
    await bestEffort("notify involved", () =>
      notifyInvolved(updated, `Acknowledged by a ${actor.role}. Help is being arranged.`, actor.id),
    );
    return updated;
  },

  /** POST /:id/respond. The acknowledger is on the way. */
  respond: async (id: string, actor: Actor): Promise<Emergency> => {
    const emergency = await loadForActor(id, actor);
    if (!same(emergency.acknowledgedBy, actor.id)) {
      throw new ForbiddenError("Only the person who acknowledged it can mark it as en route");
    }

    const updated = await emergencyRepository.transition(id, ["acknowledged"], {
      status: "responding",
      respondingUserId: actor.id,
      respondingAt: new Date(),
    });
    if (!updated) return conflictFor(id, "respond");

    await bestEffort("notify involved", () =>
      notifyInvolved(updated, "A responder is on the way.", actor.id),
    );
    return updated;
  },

  /** POST /:id/resolve. Closes it with a mandatory note. */
  resolve: async (id: string, input: ResolveEmergencyInput, actor: Actor): Promise<Emergency> => {
    const emergency = await loadForActor(id, actor);
    const isClaimer =
      same(emergency.acknowledgedBy, actor.id) || same(emergency.respondingUserId, actor.id);
    if (!isClaimer && !isStaff(actor.role)) {
      throw new ForbiddenError("Only the person handling it or a coordinator can resolve it");
    }

    const updated = await emergencyRepository.transition(id, ACTIVE_STATUSES, {
      status: "resolved",
      resolvedBy: actor.id,
      resolvedAt: new Date(),
      resolutionNote: input.resolutionNote,
      isOpen: false,
      nextEscalationAt: null,
    });
    if (!updated) return conflictFor(id, "resolve");

    await bestEffort("cancel pending escalations", () => cancelPendingEscalations(id));
    await bestEffort("publish emergency.resolved", () =>
      publish("emergency.resolved", { emergencyId: id, resolvedBy: actor.id }),
    );
    await bestEffort("notify involved", () =>
      notifyInvolved(updated, `Resolved: ${input.resolutionNote}`, actor.id),
    );
    return updated;
  },

  /**
   * POST /:id/false-alarm. Also publishes `emergency.resolved`, so the live
   * board clears it; the event contract has no separate false-alarm event.
   */
  falseAlarm: async (id: string, input: FalseAlarmInput, actor: Actor): Promise<Emergency> => {
    const emergency = await loadForActor(id, actor);
    const isRaiser = same(emergency.raisedBy, actor.id);
    const isClaimer =
      same(emergency.acknowledgedBy, actor.id) || same(emergency.respondingUserId, actor.id);

    let allowedFrom: readonly EmergencyStatus[];
    if (isStaff(actor.role)) {
      allowedFrom = ACTIVE_STATUSES;
    } else if (isClaimer) {
      allowedFrom = ["acknowledged", "responding"];
    } else if (isRaiser) {
      const ageSeconds = (Date.now() - emergency.createdAt.getTime()) / 1000;
      if (ageSeconds > FALSE_ALARM_GRACE_SECONDS) {
        throw new ForbiddenError(
          `The ${FALSE_ALARM_GRACE_SECONDS}-second window to cancel has passed. Ask a coordinator to close it.`,
        );
      }
      allowedFrom = UNCLAIMED_STATUSES;
    } else {
      throw new ForbiddenError(
        "Only the person who raised it, the person handling it, or a coordinator can cancel it",
      );
    }

    const updated = await emergencyRepository.transition(id, allowedFrom, {
      status: "false_alarm",
      falseAlarmBy: actor.id,
      falseAlarmAt: new Date(),
      falseAlarmNote: input.note ?? null,
      isOpen: false,
      nextEscalationAt: null,
    });
    if (!updated) return conflictFor(id, "cancel");

    await bestEffort("cancel pending escalations", () => cancelPendingEscalations(id));
    await bestEffort("publish emergency.resolved", () =>
      publish("emergency.resolved", { emergencyId: id, resolvedBy: actor.id }),
    );
    await bestEffort("notify involved", () =>
      notifyInvolved(updated, "Cancelled as a false alarm. No action needed.", actor.id),
    );
    return updated;
  },

  /** GET /elders/:elderId/history. Staff, or the elder's circle. Fails closed. */
  history: async (
    elderId: string,
    query: { page?: unknown; limit?: unknown },
    actor: Actor,
  ): Promise<Paginated<Emergency>> => {
    if (!isStaff(actor.role)) {
      const access = await emergencyDeps().elder.checkAccess(elderId, actor);
      if (access.decision !== "allowed") throw new NotFoundError("Elder");
    }
    const { page, limit, skip } = parsePagination(query);
    const [items, total] = await emergencyRepository.findElderHistoryPage(elderId, skip, limit);
    return buildPage(items, total, page, limit);
  },

  /**
   * POST /:id/escalate. A coordinator skips the timer and fires the next rung
   * now. The rung after it keeps its original time (measured from the raise).
   */
  escalate: async (id: string, input: EscalateEmergencyInput, actor: Actor): Promise<Emergency> => {
    const emergency = await emergencyRepository.findById(id);
    if (!emergency) throw new NotFoundError("Emergency");
    if (!isUnclaimed(emergency.status)) return conflictFor(id, "escalate");

    const policy = await escalationPolicy.forSeverity(emergency.severity as EmergencySeverity);
    const next = policy.levels.find((l) => l.level === emergency.escalationLevel + 1);
    if (!next) throw new ConflictError("Already at the top of the escalation ladder");

    const advanced = await emergencyRepository.advanceLevel(
      id,
      emergency.escalationLevel,
      next.level,
      { nextEscalationAt: null },
    );
    if (!advanced) return conflictFor(id, "escalate");

    await scheduleLevel(
      {
        emergencyId: id,
        level: next.level,
        trigger: "manual",
        triggeredBy: actor.id,
        reason: input.reason ?? null,
      },
      0,
    );
    return advanced;
  },

  /** GET /policies. Every severity, most severe first, stored or default. */
  listPolicies: async (): Promise<ResolvedPolicy[]> =>
    Promise.all(
      [...EMERGENCY_SEVERITIES].reverse().map((severity) => escalationPolicy.forSeverity(severity)),
    ),

  /**
   * PUT /policies. Replaces one severity's ladder. Applies to rungs scheduled
   * from now on; jobs already waiting keep the time they were given.
   */
  updatePolicy: async (input: UpdatePolicyInput, actor: Actor): Promise<ResolvedPolicy> => {
    const stored = await emergencyRepository.upsertPolicy(input.severity, input.levels, actor.id);
    return {
      severity: input.severity,
      levels: input.levels,
      isDefault: false,
      updatedBy: stored?.updatedBy ?? actor.id,
      updatedAt: stored?.updatedAt ?? new Date(),
    };
  },

  /**
   * visit.missed (from visit-service): nobody arrived for a scheduled visit.
   * Raises a no_response alert for a high-dependency elder (high), or when
   * dependency cannot be checked yet (medium, failing open). A confirmed
   * low-dependency elder gets no alert; booking-service handles the booking.
   */
  handleVisitMissed: async (visitId: string, bookingId: string): Promise<void> => {
    const sourceKey = `visit.missed:${visitId}`;
    const deps = emergencyDeps();

    let elderId: string | null;
    try {
      elderId = await deps.booking.getElderIdForBooking(bookingId);
    } catch (err) {
      return skipAutomatic(sourceKey, (err as Error).message);
    }
    if (!elderId) return skipAutomatic(sourceKey, `booking ${bookingId} not found`);

    let highDependency: boolean | null = null;
    try {
      highDependency = (await deps.elder.getEmergencyBrief(elderId))?.isHighDependency ?? null;
    } catch {
      highDependency = null;
    }
    if (highDependency === false) {
      logger.info(`[emergency] ${sourceKey}: elder is not high-dependency, no alert`);
      return;
    }

    await raiseAutomatically({
      elderId,
      type: "no_response",
      severity: highDependency ? "high" : "medium",
      description:
        highDependency === null
          ? "No caregiver arrived for a scheduled visit. Dependency level could not be checked."
          : "No caregiver arrived for a scheduled visit to a high-dependency elder.",
      activeBookingId: bookingId,
      sourceKey,
    });
  },

  /**
   * visit.geofence.breached (from visit-service): the caregiver left the
   * elder's location mid-visit, so the elder may be alone unexpectedly.
   */
  handleGeofenceBreach: async (visitId: string, distanceMeters: number): Promise<void> => {
    const sourceKey = `visit.geofence.breached:${visitId}`;

    let elderId: string | null;
    try {
      elderId = await emergencyDeps().visits.getElderIdForVisit(visitId);
    } catch (err) {
      return skipAutomatic(sourceKey, (err as Error).message);
    }
    if (!elderId) return skipAutomatic(sourceKey, `visit ${visitId} not found`);

    await raiseAutomatically({
      elderId,
      type: "no_response",
      severity: "medium",
      description: `The caregiver left the visit location (${Math.round(distanceMeters)} m away) before the visit ended.`,
      sourceKey,
    });
  },

  /**
   * Run by the emergency worker for every rung. THE GUARD lives here:
   *
   *   1. Re-read the emergency. Closed? Stop.
   *   2. Level 1+: climb one rung atomically, only if still unclaimed and at
   *      the level below. Then act only if it is unclaimed AT this level.
   *   3. Fire the level. If its steps already existed, another job did this
   *      level, so stop without publishing or scheduling twice.
   *   4. Publish emergency.escalated and queue the next rung.
   *
   * So a timer that fires after an acknowledgement, a resolution, or a manual
   * escalation that already moved past it, does nothing. That is what makes
   * the ladder idempotent; cancelling jobs is only an optimisation.
   */
  handleDispatchJob: async (job: DispatchLevelJob): Promise<void> => {
    const id = job.emergencyId;
    const found = await emergencyRepository.findById(id);
    if (!found || !found.isOpen) return;

    const policy = await escalationPolicy.forSeverity(found.severity as EmergencySeverity);
    const policyLevel = policy.levels.find((l) => l.level === job.level);
    if (!policyLevel) return;

    if (job.level === 0) {
      await dispatchLevel(found, policyLevel, job.trigger, job.triggeredBy);
      return;
    }

    let emergency: Emergency | null = found;
    if (found.escalationLevel === job.level - 1) {
      emergency =
        (await emergencyRepository.advanceLevel(id, job.level - 1, job.level)) ??
        (await emergencyRepository.findById(id));
    }
    if (
      !emergency ||
      !emergency.isOpen ||
      !isUnclaimed(emergency.status) ||
      emergency.escalationLevel !== job.level
    ) {
      logger.info(
        `[emergency] ${id} L${job.level} (${job.trigger}) not needed: ${emergency?.status ?? "missing"} at L${emergency?.escalationLevel ?? "?"}`,
      );
      return;
    }

    const { freshSteps } = await dispatchLevel(
      emergency,
      policyLevel,
      job.trigger,
      job.triggeredBy,
      job.reason ?? null,
    );
    if (freshSteps === 0) return;

    await bestEffort("publish emergency.escalated", () =>
      publish("emergency.escalated", { emergencyId: id, level: job.level }),
    );
    await scheduleFollowing(emergency, policy, job.level);
  },
};
