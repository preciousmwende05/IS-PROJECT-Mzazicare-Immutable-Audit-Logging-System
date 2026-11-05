/**
 * U-CS 72 — Priority Emergency Handling & Escalation System
 * Owner(s): Wyclef Wasike Tavasi
 *
 * "Who do we tell at level N?" and "tell them".
 *
 * Nothing in here throws on a failed lookup or a failed send. A target that
 * cannot be resolved is recorded on the escalation trail with a note saying
 * why, and the ladder carries on: a failure is exactly when the next level
 * matters most.
 */

import logger from "@/shared/config/logger";
import type {
  Emergency,
  EscalationTargetType,
  EscalationTrigger,
} from "@/modules/emergency-service/models/emergency.model";
import type { PolicyLevel } from "@/modules/emergency-service/models/escalation-policy.defaults";
import { emergencyRepository } from "@/modules/emergency-service/repository/emergency.repository";
import {
  emergencyDeps,
  type ElderEmergencyBrief,
  type EmergencyNotification,
} from "@/modules/emergency-service/services/emergency.dependencies";

type Contact = { id: string; name: string; phone: string };

export type ResolvedTarget = {
  targetType: EscalationTargetType;
  userIds: string[];
  contacts: Contact[];
  note: string | null;
};

/** Target types whose ids are user ids (as opposed to emergency-contact ids). */
const USER_TARGETS: readonly EscalationTargetType[] = ["care_circle", "caregiver", "coordinator"];

const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const unique = (ids: (string | null | undefined)[]): string[] => [
  ...new Set(ids.filter((id): id is string => Boolean(id))),
];

const TYPE_LABEL: Record<string, string> = {
  fall: "a fall",
  medical: "a medical emergency",
  no_response: "no response",
  security: "a security incident",
  other: "an emergency",
};

/** The elder brief is needed by two target types; fetch it at most once per level. */
const briefLoader = (elderId: string) => {
  let pending: Promise<{ brief: ElderEmergencyBrief | null; error: string | null }> | null = null;
  return () => {
    pending ??= emergencyDeps()
      .elder.getEmergencyBrief(elderId)
      .then((brief) => ({ brief, error: brief ? null : "elder not found" }))
      .catch((err: unknown) => ({ brief: null, error: reasonOf(err) }));
    return pending;
  };
};

const resolveTarget = async (
  targetType: EscalationTargetType,
  emergency: Emergency,
  loadBrief: ReturnType<typeof briefLoader>,
): Promise<ResolvedTarget> => {
  const elderId = String(emergency.elderId);
  const empty = (note: string): ResolvedTarget => ({ targetType, userIds: [], contacts: [], note });

  switch (targetType) {
    case "care_circle": {
      const { brief, error } = await loadBrief();
      if (!brief) return empty(`Care circle unavailable: ${error}`);
      return { targetType, userIds: unique(brief.careCircleUserIds), contacts: [], note: null };
    }

    case "caregiver": {
      if (emergency.raisedVia === "caregiver") {
        return empty("The on-site caregiver raised this emergency");
      }
      try {
        const userIds = unique(await emergencyDeps().booking.getOnSiteCaregiverUserIds(elderId));
        return {
          targetType,
          userIds,
          contacts: [],
          note: userIds.length ? null : "No caregiver on site",
        };
      } catch (err) {
        return empty(`On-site caregiver unavailable: ${reasonOf(err)}`);
      }
    }

    case "coordinator": {
      try {
        const userIds = unique(await emergencyDeps().users.listActiveUserIdsByRole("coordinator"));
        return {
          targetType,
          userIds,
          contacts: [],
          note: userIds.length ? null : "No active coordinators",
        };
      } catch (err) {
        return empty(
          `Coordinators unavailable: ${reasonOf(err)}. They still see it on the live queue.`,
        );
      }
    }

    case "emergency_contact": {
      const { brief, error } = await loadBrief();
      if (!brief) return empty(`Emergency contacts unavailable: ${error}`);
      const contacts = [...brief.emergencyContacts]
        .sort((a, b) => a.priority - b.priority)
        .map(({ id, name, phone }) => ({ id, name, phone }));
      return {
        targetType,
        userIds: [],
        contacts,
        note: contacts.length ? null : "No emergency contacts on file",
      };
    }

    case "external":
      return empty(
        "No external dispatch integration. A coordinator must call emergency services (999 or 112) directly.",
      );
  }
};

const alertText = (
  emergency: Emergency,
  level: number,
  brief: ElderEmergencyBrief | null,
): { title: string; body: string } => {
  const who = brief?.displayName ?? "an elder in your care";
  const what = TYPE_LABEL[emergency.type] ?? "an emergency";
  const urgency = level > 0 ? " Nobody has acknowledged it yet." : "";
  return {
    title: `MzaziCare ${emergency.severity.toUpperCase()} emergency`,
    body: `${what[0]?.toUpperCase()}${what.slice(1)} reported for ${who}.${urgency} Open MzaziCare to acknowledge.`,
  };
};

/**
 * Fire one level of the ladder: resolve every target type the policy names,
 * append a trail step for each, and send ONE combined alert.
 *
 * Idempotent: a step that already exists for this (emergency, level, target)
 * is skipped by the database, and its recipients are not alerted again.
 * `freshSteps` is 0 when this level had already fired, which tells the caller
 * another job got here first.
 */
export const dispatchLevel = async (
  emergency: Emergency,
  policyLevel: PolicyLevel,
  trigger: EscalationTrigger,
  triggeredBy: string | null,
  reason: string | null = null,
): Promise<{ userIds: string[]; contacts: Contact[]; freshSteps: number }> => {
  const emergencyId = String(emergency._id);
  const raiser = emergency.raisedBy ? String(emergency.raisedBy) : null;
  const loadBrief = briefLoader(String(emergency.elderId));
  const firedAt = new Date();

  const fresh: ResolvedTarget[] = [];
  for (const targetType of policyLevel.targets) {
    const target = await resolveTarget(targetType, emergency, loadBrief);
    const step = await emergencyRepository.appendStep({
      emergencyId,
      level: policyLevel.level,
      targetType,
      targetIds: [...target.userIds, ...target.contacts.map((c) => c.id)],
      trigger,
      triggeredBy,
      firedAt,
      note:
        [reason ? `Manual escalation: ${reason}` : null, target.note].filter(Boolean).join(" | ") ||
        null,
    });
    if (!step) continue; // this rung already fired for this target: say nothing, send nothing
    fresh.push(target);
    if (target.note) {
      logger.warn(`[emergency] ${emergencyId} L${policyLevel.level} ${targetType}: ${target.note}`);
    }
  }

  if (fresh.length === 0) {
    logger.info(
      `[emergency] ${emergencyId} L${policyLevel.level} (${trigger}) not needed: already fired, nothing sent`,
    );
    return { userIds: [], contacts: [], freshSteps: 0 };
  }

  // The raiser already knows. Everyone else hears once, however many target types they match.
  const userIds = unique(fresh.flatMap((t) => t.userIds)).filter((id) => id !== raiser);
  const contacts = [...new Map(fresh.flatMap((t) => t.contacts).map((c) => [c.id, c])).values()];

  if (userIds.length || contacts.length) {
    const { brief } = await loadBrief();
    await send({
      kind: "emergency.alert",
      emergencyId,
      elderId: String(emergency.elderId),
      severity: emergency.severity,
      level: policyLevel.level,
      userIds,
      phones: contacts.map(({ name, phone }) => ({ name, phone })),
      ...alertText(emergency, policyLevel.level, brief),
      overridesPreferences: true,
    });
  }

  logger.info(
    `[emergency] ${emergencyId} L${policyLevel.level} (${trigger}) alerted ${userIds.length} user(s) and ${contacts.length} contact(s)`,
  );
  return { userIds, contacts, freshSteps: fresh.length };
};

/**
 * Tell everyone who has been involved so far (raiser, claimer, every user and
 * contact on the trail) that something changed. `exceptUserId` is whoever
 * caused the change; they already know.
 */
export const notifyInvolved = async (
  emergency: Emergency,
  body: string,
  exceptUserId: string | null,
): Promise<void> => {
  const steps = await emergencyRepository.findSteps(String(emergency._id));

  const userIds = unique([
    emergency.raisedBy ? String(emergency.raisedBy) : null,
    emergency.acknowledgedBy ? String(emergency.acknowledgedBy) : null,
    emergency.respondingUserId ? String(emergency.respondingUserId) : null,
    ...steps.filter((s) => USER_TARGETS.includes(s.targetType)).flatMap((s) => s.targetIds),
  ]).filter((id) => id !== exceptUserId);

  const contactIds = new Set(
    steps.filter((s) => s.targetType === "emergency_contact").flatMap((s) => s.targetIds),
  );
  let phones: { name: string; phone: string }[] = [];
  if (contactIds.size) {
    const { brief } = await briefLoader(String(emergency.elderId))();
    phones = (brief?.emergencyContacts ?? [])
      .filter((c) => contactIds.has(c.id))
      .map(({ name, phone }) => ({ name, phone }));
  }

  if (!userIds.length && !phones.length) return;

  await send({
    kind: "emergency.update",
    emergencyId: String(emergency._id),
    elderId: String(emergency.elderId),
    severity: emergency.severity,
    level: null,
    userIds,
    phones,
    title: "MzaziCare emergency update",
    body,
    overridesPreferences: true,
  });
};

/** A failed send is logged, never thrown: the ladder must not stall on a notification channel. */
const send = async (notification: EmergencyNotification): Promise<void> => {
  try {
    await emergencyDeps().notifications.send(notification);
  } catch (err) {
    logger.error(
      `[emergency] could not queue ${notification.kind} for ${notification.emergencyId}: ${reasonOf(err)}`,
    );
  }
};
