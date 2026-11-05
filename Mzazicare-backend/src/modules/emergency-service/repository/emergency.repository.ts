/**
 * U-CS 72 — Priority Emergency Handling & Escalation System
 * Owner(s): Wyclef Wasike Tavasi
 */

import type { GeoPoint } from "@/shared/types";
import {
  ACTIVE_STATUSES,
  EmergencyModel,
  EscalationPolicyModel,
  EscalationStepModel,
  UNCLAIMED_STATUSES,
  type Emergency,
  type EmergencyRaisedVia,
  type EmergencySeverity,
  type EmergencyStatus,
  type EmergencyType,
  type EscalationPolicy,
  type EscalationStep,
  type EscalationTargetType,
  type EscalationTrigger,
} from "@/modules/emergency-service/models/emergency.model";
import type { PolicyLevel } from "@/modules/emergency-service/models/escalation-policy.defaults";

/** Ids are plain strings at this boundary; Mongoose casts them to ObjectIds. */
export type CreateEmergencyData = {
  elderId: string;
  raisedBy: string | null;
  raisedVia: EmergencyRaisedVia;
  type: EmergencyType;
  severity: EmergencySeverity;
  severityRank: number;
  description: string | null;
  location: GeoPoint | null;
  activeBookingId: string | null;
  raiserVerified: boolean;
  lastPressedAt: Date;
  nextEscalationAt: Date | null;
  sourceKey: string | null;
};

export type EmergencyPatch = Partial<{
  status: EmergencyStatus;
  severity: EmergencySeverity;
  severityRank: number;
  escalationLevel: number;
  nextEscalationAt: Date | null;
  isOpen: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
  respondingUserId: string | null;
  respondingAt: Date | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  falseAlarmBy: string | null;
  falseAlarmAt: Date | null;
  falseAlarmNote: string | null;
}>;

export type AppendStepData = {
  emergencyId: string;
  level: number;
  targetType: EscalationTargetType;
  targetIds: string[];
  trigger: EscalationTrigger;
  triggeredBy: string | null;
  firedAt: Date;
  note: string | null;
};

const isDuplicateKey = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { code?: unknown }).code === 11000;

/**
 * The only layer allowed to touch the database. Repositories answer data
 * questions ("find these rows"); they never decide anything.
 *
 * There is deliberately no delete. Emergencies are safety records.
 */
export const emergencyRepository = {
  // -------------------------------------------------------------------------
  // Emergencies
  // -------------------------------------------------------------------------

  findById: async (id: string): Promise<Emergency | null> =>
    EmergencyModel.findById(id).lean<Emergency>(),

  /**
   * Insert a new open emergency. Returns null when the elder already has an
   * open one (the unique partial index rejected the insert), so the caller
   * can collapse into it instead.
   */
  create: async (data: CreateEmergencyData): Promise<Emergency | null> => {
    try {
      const doc = await EmergencyModel.create({ ...data, status: "raised", isOpen: true });
      return doc.toObject() as Emergency;
    } catch (err) {
      if (isDuplicateKey(err)) return null;
      throw err;
    }
  },

  update: async (id: string, patch: EmergencyPatch): Promise<Emergency | null> =>
    EmergencyModel.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean<Emergency>(),

  /**
   * Compare-and-set on status. Applies `patch` only if the emergency is still
   * in one of `from`, in a single atomic update. Returns null when it was not:
   * someone else acknowledged, resolved or cancelled it first.
   */
  transition: async (
    id: string,
    from: readonly EmergencyStatus[],
    patch: EmergencyPatch,
  ): Promise<Emergency | null> =>
    EmergencyModel.findOneAndUpdate(
      { _id: id, status: { $in: from } },
      { $set: patch },
      { new: true },
    ).lean<Emergency>(),

  /**
   * Climb exactly one rung of the ladder, atomically. Matches only while the
   * emergency is unclaimed AND still at `fromLevel`, so a timer that fires
   * after an acknowledgement, a resolution, or a manual escalation that
   * already moved it on, changes nothing and gets null back.
   */
  advanceLevel: async (
    id: string,
    fromLevel: number,
    toLevel: number,
    patch: EmergencyPatch = {},
  ): Promise<Emergency | null> =>
    EmergencyModel.findOneAndUpdate(
      { _id: id, status: { $in: UNCLAIMED_STATUSES }, escalationLevel: fromLevel },
      { $set: { ...patch, escalationLevel: toLevel, status: "escalated" } },
      { new: true },
    ).lean<Emergency>(),

  /** The emergency an automatic event already raised, if any (open or closed). */
  findBySourceKey: async (sourceKey: string): Promise<Emergency | null> =>
    EmergencyModel.findOne({ sourceKey }).lean<Emergency>(),

  /** The open emergency for an elder, if any. */
  findOpenForElder: async (elderId: string): Promise<Emergency | null> =>
    EmergencyModel.findOne({ elderId, isOpen: true }).lean<Emergency>(),

  /**
   * Another press on an emergency that is already open. Counted, never
   * dropped. `raiseTo` lifts the severity when the new report is more severe;
   * severity never goes down this way.
   */
  recordPress: async (
    id: string,
    at: Date,
    raiseTo?: { severity: EmergencySeverity; severityRank: number },
  ): Promise<Emergency | null> =>
    EmergencyModel.findByIdAndUpdate(
      id,
      { $inc: { pressCount: 1 }, $set: { lastPressedAt: at, ...raiseTo } },
      { new: true },
    ).lean<Emergency>(),

  /** The live queue: most severe first, then oldest first. */
  findQueuePage: async (
    where: { status?: EmergencyStatus; severity?: EmergencySeverity },
    skip: number,
    limit: number,
  ): Promise<[Emergency[], number]> => {
    const filter = {
      status: where.status ?? { $in: ACTIVE_STATUSES },
      ...(where.severity && { severity: where.severity }),
    };
    return Promise.all([
      EmergencyModel.find(filter)
        .sort({ severityRank: -1, createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .lean<Emergency[]>(),
      EmergencyModel.countDocuments(filter),
    ]);
  },

  /** Every emergency for one elder, newest first. */
  findElderHistoryPage: async (
    elderId: string,
    skip: number,
    limit: number,
  ): Promise<[Emergency[], number]> =>
    Promise.all([
      EmergencyModel.find({ elderId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<Emergency[]>(),
      EmergencyModel.countDocuments({ elderId }),
    ]),

  // -------------------------------------------------------------------------
  // Escalation trail (append-only)
  // -------------------------------------------------------------------------

  /**
   * Append one step. Returns null if that step (same emergency, level and
   * target type) is already recorded, which is how a duplicate job is
   * absorbed without double-notifying anyone.
   */
  appendStep: async (data: AppendStepData): Promise<EscalationStep | null> => {
    try {
      const doc = await EscalationStepModel.create(data);
      return doc.toObject() as EscalationStep;
    } catch (err) {
      if (isDuplicateKey(err)) return null;
      throw err;
    }
  },

  findSteps: async (emergencyId: string): Promise<EscalationStep[]> =>
    EscalationStepModel.find({ emergencyId })
      .sort({ level: 1, firedAt: 1 })
      .lean<EscalationStep[]>(),

  /** Was this user told about this emergency at any level? */
  wasNotified: async (emergencyId: string, userId: string): Promise<boolean> =>
    Boolean(await EscalationStepModel.exists({ emergencyId, targetIds: userId })),

  markStepsAcknowledged: async (emergencyId: string): Promise<void> => {
    await EscalationStepModel.updateMany(
      { emergencyId, acknowledged: false },
      { $set: { acknowledged: true } },
    );
  },

  // -------------------------------------------------------------------------
  // Escalation policies
  // -------------------------------------------------------------------------

  findPolicy: async (severity: EmergencySeverity): Promise<EscalationPolicy | null> =>
    EscalationPolicyModel.findOne({ severity }).lean<EscalationPolicy>(),

  findAllPolicies: async (): Promise<EscalationPolicy[]> =>
    EscalationPolicyModel.find().lean<EscalationPolicy[]>(),

  upsertPolicy: async (
    severity: EmergencySeverity,
    levels: PolicyLevel[],
    updatedBy: string,
  ): Promise<EscalationPolicy | null> =>
    EscalationPolicyModel.findOneAndUpdate(
      { severity },
      { $set: { levels, updatedBy } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    ).lean<EscalationPolicy>(),
};
