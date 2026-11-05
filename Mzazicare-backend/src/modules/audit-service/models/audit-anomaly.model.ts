/**
 * U-CS 78 — Immutable Audit Logging & Compliance System
 * Owner(s): Precious Mwende Waweru, Anthony Atenya
 *
 * An anomaly alert. Raised by three sources, all notified to admins + auditors:
 *   policy  — the backend's rule detector (3+ refusals or 5+ failed sign-ins
 *             in one 15-minute window), every few minutes
 *   iforest — the Isolation Forest (ml/audit-anomaly `live.py alert`), which
 *             inserts here directly; it never writes to the audit log itself
 *   chain   — the scheduled hash-chain verification failed
 *
 * `key` makes every source idempotent: the same window or break is one alert.
 */

import { Schema, model, type InferSchemaType, type Types } from "mongoose";

export const ANOMALY_SOURCES = ["policy", "iforest", "chain"] as const;
export const ANOMALY_STATUSES = ["open", "resolved"] as const;

const anomalySchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    source: { type: String, enum: ANOMALY_SOURCES, required: true },
    kind: { type: String, required: true }, // e.g. access_denied_burst, failed_login_burst, model, chain_broken
    actorId: { type: String, default: null },
    actorRole: { type: String, default: null },
    windowStart: { type: Date, default: null },
    windowEnd: { type: Date, default: null },
    score: { type: Number, default: null },
    summary: { type: String, required: true },
    reasons: { type: [String], default: [] },
    counts: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ANOMALY_STATUSES, default: "open" },
    notifiedAt: { type: Date, default: null },
    resolvedBy: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    resolution: { type: String, default: null },
  },
  { timestamps: true, collection: "audit_anomalies", versionKey: false },
);

anomalySchema.index({ status: 1, createdAt: -1 });
anomalySchema.index({ notifiedAt: 1 });

export type AuditAnomaly = InferSchemaType<typeof anomalySchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export type NewAuditAnomaly = Omit<InferSchemaType<typeof anomalySchema>, "createdAt" | "updatedAt">;
export const AuditAnomalyModel = model("AuditAnomaly", anomalySchema);
