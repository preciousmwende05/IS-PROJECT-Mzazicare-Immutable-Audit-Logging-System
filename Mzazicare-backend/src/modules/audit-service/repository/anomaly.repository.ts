/**
 * U-CS 78 — anomaly alerts and the raw reads the rule detector needs.
 */

import { AuditLogModel, type AuditLog } from "@/modules/audit-service/models/audit-log.model";
import {
  AuditAnomalyModel,
  type AuditAnomaly,
  type NewAuditAnomaly,
} from "@/modules/audit-service/models/audit-anomaly.model";

export const anomalyRepository = {
  /** Insert unless an alert with this key exists. Returns the new alert, or null if it existed. */
  createOnce: async (data: Omit<NewAuditAnomaly, "status" | "notifiedAt" | "resolvedBy" | "resolvedAt" | "resolution">): Promise<AuditAnomaly | null> => {
    const res = await AuditAnomalyModel.updateOne({ key: data.key }, { $setOnInsert: { ...data, status: "open", notifiedAt: null } }, { upsert: true });
    return res.upsertedCount ? AuditAnomalyModel.findOne({ key: data.key }).lean<AuditAnomaly>() : null;
  },

  findUnnotified: async (limit = 50): Promise<AuditAnomaly[]> =>
    AuditAnomalyModel.find({ notifiedAt: null }).sort({ createdAt: 1 }).limit(limit).lean<AuditAnomaly[]>(),

  markNotified: async (id: unknown): Promise<void> => {
    await AuditAnomalyModel.updateOne({ _id: id }, { $set: { notifiedAt: new Date() } });
  },

  findPage: async (where: Record<string, unknown>, skip: number, limit: number): Promise<[AuditAnomaly[], number]> =>
    Promise.all([
      AuditAnomalyModel.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).lean<AuditAnomaly[]>(),
      AuditAnomalyModel.countDocuments(where),
    ]),

  resolve: async (id: string, by: string, note: string): Promise<AuditAnomaly | null> =>
    AuditAnomalyModel.findOneAndUpdate(
      { _id: id, status: "open" },
      { $set: { status: "resolved", resolvedBy: by, resolvedAt: new Date(), resolution: note } },
      { new: true },
    ).lean<AuditAnomaly>(),

  /** Refusals and failed sign-ins since `from` (real entries only, not seeded ones). */
  findRefusalsSince: async (from: Date): Promise<AuditLog[]> =>
    AuditLogModel.find({
      action: { $in: ["access.denied", "auth.login.failed"] },
      occurredAt: { $gte: from },
      "metadata.seed": { $ne: true },
    })
      .sort({ sequence: 1 })
      .lean<AuditLog[]>(),
};
