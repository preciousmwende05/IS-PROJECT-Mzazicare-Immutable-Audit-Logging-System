/**
 * U-CS 72 — Priority Emergency Handling & Escalation System
 * Owner(s): Wyclef Wasike Tavasi
 */

import type { Emergency, EscalationStep } from "@/modules/emergency-service/models/emergency.model";
import type { PolicyLevel } from "@/modules/emergency-service/models/escalation-policy.defaults";

/**
 * The shapes the API returns. Views exist so that a document can never leak a
 * field by accident: add a field here deliberately or the client never sees it.
 */

const idOrNull = (value: unknown): string | null => (value ? String(value) : null);
const isoOrNull = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;

/** GeoJSON stores [lng, lat]; clients get named fields so nobody has to remember the order. */
const toLatLng = (
  point: { coordinates?: number[] | null } | null | undefined,
): { latitude: number; longitude: number } | null => {
  const [longitude, latitude] = point?.coordinates ?? [];
  if (longitude === undefined || latitude === undefined) return null;
  return { latitude, longitude };
};

export type EmergencyView = {
  id: string;
  elderId: string;
  raisedBy: string | null;
  raisedVia: string;
  type: string;
  severity: string;
  description: string | null;
  location: { latitude: number; longitude: number } | null;
  status: string;
  escalationLevel: number;
  nextEscalationAt: string | null;
  pressCount: number;
  lastPressedAt: string | null;
  /** False when the raiser's link to the elder could not be checked at the time. */
  raiserVerified: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  respondingUserId: string | null;
  respondingAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  falseAlarmBy: string | null;
  falseAlarmAt: string | null;
  falseAlarmNote: string | null;
  activeBookingId: string | null;
  /** Set on automatic alerts: the event that raised it, e.g. "visit.missed:<visitId>". */
  sourceKey: string | null;
  createdAt: string;
  updatedAt: string;
};

export const serializeEmergency = (emergency: Emergency): EmergencyView => ({
  id: String(emergency._id),
  elderId: String(emergency.elderId),
  raisedBy: idOrNull(emergency.raisedBy),
  raisedVia: emergency.raisedVia,
  type: emergency.type,
  severity: emergency.severity,
  description: emergency.description ?? null,
  location: toLatLng(emergency.location),
  status: emergency.status,
  escalationLevel: emergency.escalationLevel,
  nextEscalationAt: isoOrNull(emergency.nextEscalationAt),
  pressCount: emergency.pressCount ?? 1,
  lastPressedAt: isoOrNull(emergency.lastPressedAt),
  raiserVerified: emergency.raiserVerified ?? true,
  acknowledgedBy: idOrNull(emergency.acknowledgedBy),
  acknowledgedAt: isoOrNull(emergency.acknowledgedAt),
  respondingUserId: idOrNull(emergency.respondingUserId),
  respondingAt: isoOrNull(emergency.respondingAt),
  resolvedBy: idOrNull(emergency.resolvedBy),
  resolvedAt: isoOrNull(emergency.resolvedAt),
  resolutionNote: emergency.resolutionNote ?? null,
  falseAlarmBy: idOrNull(emergency.falseAlarmBy),
  falseAlarmAt: isoOrNull(emergency.falseAlarmAt),
  falseAlarmNote: emergency.falseAlarmNote ?? null,
  activeBookingId: idOrNull(emergency.activeBookingId),
  sourceKey: emergency.sourceKey ?? null,
  createdAt: emergency.createdAt.toISOString(),
  updatedAt: emergency.updatedAt.toISOString(),
});

export type EscalationStepView = {
  id: string;
  level: number;
  targetType: string;
  targetIds: string[];
  trigger: string;
  triggeredBy: string | null;
  firedAt: string;
  acknowledged: boolean;
  /** Why targetIds is empty or partial. */
  note: string | null;
};

export const serializeEscalationStep = (step: EscalationStep): EscalationStepView => ({
  id: String(step._id),
  level: step.level,
  targetType: step.targetType,
  targetIds: [...(step.targetIds ?? [])],
  trigger: step.trigger,
  triggeredBy: idOrNull(step.triggeredBy),
  firedAt: step.firedAt.toISOString(),
  acknowledged: step.acknowledged ?? false,
  note: step.note ?? null,
});

/** GET /:id. The emergency plus its escalation trail, oldest step first. */
export type EmergencyDetailView = EmergencyView & { escalationTrail: EscalationStepView[] };

export const serializeEmergencyDetail = (
  emergency: Emergency,
  steps: EscalationStep[],
): EmergencyDetailView => ({
  ...serializeEmergency(emergency),
  escalationTrail: steps.map(serializeEscalationStep),
});

export type EscalationPolicyView = {
  severity: string;
  levels: PolicyLevel[];
  /** True when no admin has saved a policy and the built-in default applies. */
  isDefault: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
};

export const serializeEscalationPolicy = (policy: {
  severity: string;
  levels: PolicyLevel[];
  isDefault: boolean;
  updatedBy?: unknown;
  updatedAt?: Date | null;
}): EscalationPolicyView => ({
  severity: policy.severity,
  levels: policy.levels.map((l) => ({
    level: l.level,
    targets: [...l.targets],
    afterSeconds: l.afterSeconds,
  })),
  isDefault: policy.isDefault,
  updatedBy: idOrNull(policy.updatedBy),
  updatedAt: isoOrNull(policy.updatedAt),
});
