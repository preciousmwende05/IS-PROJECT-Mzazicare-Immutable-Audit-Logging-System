/**
 * U-CS 72 — Priority Emergency Handling & Escalation System
 * Owner(s): Wyclef Wasike Tavasi
 *
 * Three collections, all owned by this module:
 *   Emergency         → `emergencies`          one row per incident
 *   EscalationStep    → `escalation_steps`     append-only trail: who was told, at what level, when
 *   EscalationPolicy  → `escalation_policies`  the ladder per severity (defaults live in code)
 */

import { Schema, model, type InferSchemaType, type HydratedDocument, type Types } from "mongoose";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const EMERGENCY_TYPES = ["fall", "medical", "no_response", "security", "other"] as const;
export const EMERGENCY_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const EMERGENCY_RAISED_VIA = [
  "panic_button",
  "caregiver",
  "family",
  "auto_detected",
] as const;
export const EMERGENCY_STATUSES = [
  "raised",
  "escalated",
  "acknowledged",
  "responding",
  "resolved",
  "false_alarm",
] as const;
export const ESCALATION_TARGET_TYPES = [
  "care_circle",
  "caregiver",
  "coordinator",
  "emergency_contact",
  "external",
] as const;
/** Why a step fired: on creation, because a timer ran out, or because a coordinator pushed it. */
export const ESCALATION_TRIGGERS = ["initial", "timer", "manual"] as const;

export type EmergencyType = (typeof EMERGENCY_TYPES)[number];
export type EmergencySeverity = (typeof EMERGENCY_SEVERITIES)[number];
export type EmergencyRaisedVia = (typeof EMERGENCY_RAISED_VIA)[number];
export type EmergencyStatus = (typeof EMERGENCY_STATUSES)[number];
export type EscalationTargetType = (typeof ESCALATION_TARGET_TYPES)[number];
export type EscalationTrigger = (typeof ESCALATION_TRIGGERS)[number];

/** Nobody has claimed it yet, so the ladder keeps climbing. The escalation guard checks this. */
export const UNCLAIMED_STATUSES: readonly EmergencyStatus[] = ["raised", "escalated"];
/** Open in any way. These appear on the coordinators' live queue. */
export const ACTIVE_STATUSES: readonly EmergencyStatus[] = [
  "raised",
  "escalated",
  "acknowledged",
  "responding",
];
/** Terminal. Nothing moves an emergency out of these. */
export const CLOSED_STATUSES: readonly EmergencyStatus[] = ["resolved", "false_alarm"];

export const MAX_ESCALATION_LEVEL = 3;

/**
 * Severity as a number, so the live queue can sort on it. Sorting the string
 * would put "medium" above "critical".
 */
export const SEVERITY_RANK: Record<EmergencySeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

// GeoJSON point. Order is [longitude, latitude].
const geoPointSchema = new Schema(
  {
    type: { type: String, enum: ["Point"], default: "Point", required: true },
    coordinates: { type: [Number], required: true },
  },
  { _id: false },
);

// ---------------------------------------------------------------------------
// Emergency → collection `emergencies`
// ---------------------------------------------------------------------------

const emergencySchema = new Schema(
  {
    elderId: { type: Schema.Types.ObjectId, ref: "Elder", required: true },
    // Null when a device raised it rather than a signed-in person.
    raisedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    raisedVia: { type: String, enum: EMERGENCY_RAISED_VIA, required: true },
    type: { type: String, enum: EMERGENCY_TYPES, required: true },
    severity: { type: String, enum: EMERGENCY_SEVERITIES, required: true },
    // Derived from severity on write. Only exists so the queue can sort numerically.
    severityRank: { type: Number, required: true, min: 1, max: 4 },
    description: { type: String, trim: true, maxlength: 1000, default: null },
    // Where it was raised. May differ from the elder's home; null if the device sent none.
    location: { type: geoPointSchema, default: null },

    status: { type: String, enum: EMERGENCY_STATUSES, default: "raised", required: true },
    escalationLevel: {
      type: Number,
      default: 0,
      min: 0,
      max: MAX_ESCALATION_LEVEL,
      required: true,
    },
    // When the next rung is due. Null once claimed, closed, or at the top of the ladder.
    nextEscalationAt: { type: Date, default: null },

    // True from raise until resolved or cancelled. Backs the one-open-emergency-per-elder index.
    isOpen: { type: Boolean, default: true, required: true },
    // False when the raiser's link to the elder could not be checked because a
    // module this one depends on is not built yet. Coordinators see the flag.
    raiserVerified: { type: Boolean, default: true, required: true },

    // Repeated panic presses collapse into one emergency, but are never dropped.
    pressCount: { type: Number, default: 1, min: 1 },
    lastPressedAt: { type: Date, default: () => new Date() },

    // An acknowledgement is a person, not a system event.
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    acknowledgedAt: { type: Date, default: null },
    respondingUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    respondingAt: { type: Date, default: null },

    resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
    // Mandatory on resolve. This is a safety record.
    resolutionNote: { type: String, trim: true, maxlength: 2000, default: null },

    falseAlarmBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    falseAlarmAt: { type: Date, default: null },
    falseAlarmNote: { type: String, trim: true, maxlength: 1000, default: null },

    // For automatic alerts: the event that caused it, e.g. "visit.missed:<visitId>".
    // Unique, so a re-delivered event can never open a second emergency.
    sourceKey: { type: String, default: null },

    // Set when a caregiver was on site at the time.
    activeBookingId: { type: Schema.Types.ObjectId, ref: "Booking", default: null },
  },
  { timestamps: true, collection: "emergencies" },
);

// The live queue: open emergencies, most severe first, then oldest first.
emergencySchema.index({ status: 1, severityRank: -1, createdAt: 1 });
// An elder's history, newest first.
emergencySchema.index({ elderId: 1, createdAt: -1 });
// At most one open emergency per elder. Two panic presses racing each other
// cannot create two incidents: the second insert is rejected and collapses
// into the first instead.
emergencySchema.index({ elderId: 1 }, { unique: true, partialFilterExpression: { isOpen: true } });
// One emergency per source event, ever.
emergencySchema.index(
  { sourceKey: 1 },
  { unique: true, partialFilterExpression: { sourceKey: { $type: "string" } } },
);

export type Emergency = InferSchemaType<typeof emergencySchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export type NewEmergency = Omit<InferSchemaType<typeof emergencySchema>, "createdAt" | "updatedAt">;
export type EmergencyDocument = HydratedDocument<Emergency>;

export const EmergencyModel = model("Emergency", emergencySchema);

// ---------------------------------------------------------------------------
// EscalationStep → collection `escalation_steps` (append-only)
// ---------------------------------------------------------------------------

const escalationStepSchema = new Schema(
  {
    emergencyId: { type: Schema.Types.ObjectId, ref: "Emergency", required: true },
    level: { type: Number, required: true, min: 0, max: MAX_ESCALATION_LEVEL },
    targetType: { type: String, enum: ESCALATION_TARGET_TYPES, required: true },
    // User ids, emergency-contact ids, or empty for `external`. Strings, because not every target is a user.
    targetIds: { type: [String], default: [] },
    trigger: { type: String, enum: ESCALATION_TRIGGERS, required: true },
    // The coordinator who pushed a manual escalation. Null for initial and timer steps.
    triggeredBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    firedAt: { type: Date, required: true },
    acknowledged: { type: Boolean, default: false },
    // Why targetIds is empty or partial, e.g. a module that cannot list the care circle yet.
    note: { type: String, trim: true, maxlength: 500, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "escalation_steps" },
);

// One row per target type per level. A second insert for the same rung is
// rejected by the database, which makes a double-fired job harmless.
escalationStepSchema.index({ emergencyId: 1, level: 1, targetType: 1 }, { unique: true });

export type EscalationStep = InferSchemaType<typeof escalationStepSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
};
export type NewEscalationStep = Omit<InferSchemaType<typeof escalationStepSchema>, "createdAt">;

export const EscalationStepModel = model("EscalationStep", escalationStepSchema);

// ---------------------------------------------------------------------------
// EscalationPolicy → collection `escalation_policies`
// ---------------------------------------------------------------------------

const policyLevelSchema = new Schema(
  {
    level: { type: Number, required: true, min: 0, max: MAX_ESCALATION_LEVEL },
    targets: { type: [String], enum: ESCALATION_TARGET_TYPES, required: true },
    // Seconds after the emergency was RAISED (not after the previous level) that this level fires.
    afterSeconds: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const escalationPolicySchema = new Schema(
  {
    severity: { type: String, enum: EMERGENCY_SEVERITIES, required: true, unique: true },
    levels: { type: [policyLevelSchema], required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, collection: "escalation_policies" },
);

export type EscalationPolicy = InferSchemaType<typeof escalationPolicySchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const EscalationPolicyModel = model("EscalationPolicy", escalationPolicySchema);
