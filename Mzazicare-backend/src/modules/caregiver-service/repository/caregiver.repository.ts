import { Types } from "mongoose";

import {
  AvailabilityModel,
  CaregiverModel,
  CaregiverVisitModel,
  KycDocumentModel,
  ProcessedEventModel,
  REQUIRED_KYC_DOC_TYPES,
  type AvailabilitySlot,
  type Caregiver,
  type CaregiverStatus,
  type KycDocStatus,
  type KycDocType,
  type KycDocument,
} from "@/modules/caregiver-service/models/caregiver.model";

const oid = (id: string) => new Types.ObjectId(id);
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000; // Africa/Nairobi is UTC+3, no DST

const toLocalSlot = (at: Date) => {
  const local = new Date(at.getTime() + EAT_OFFSET_MS);
  return { dayOfWeek: local.getUTCDay(), minute: local.getUTCHours() * 60 + local.getUTCMinutes() };
};

/* ------------------------------------------------------------------ */
/* Caregivers                                                          */
/* ------------------------------------------------------------------ */

export type NewCaregiver = {
  userId: string;
  bio: string;
  skills: string[];
  yearsExperience: number;
  serviceAreas: string[];
  baseLocation: Caregiver["baseLocation"];
  hourlyRateCents: number;
};

export type CaregiverPatch = Partial<
  Pick<
    Caregiver,
    | "bio"
    | "skills"
    | "yearsExperience"
    | "serviceAreas"
    | "baseLocation"
    | "hourlyRateCents"
    | "approvedAt"
    | "rejectedAt"
    | "rejectionReason"
    | "suspendedReason"
    | "infoRequest"
  >
> & { approvedBy?: string; reviewerId?: string };

const toUpdate = ({ approvedBy, reviewerId, ...rest }: CaregiverPatch) => ({
  ...rest,
  ...(approvedBy ? { approvedBy: oid(approvedBy) } : {}),
  ...(reviewerId ? { reviewerId: oid(reviewerId) } : {}),
});

export const caregiverRepository = {
  findById: async (id: string) =>
    Types.ObjectId.isValid(id) ? CaregiverModel.findById(id).lean<Caregiver>() : null,

  findByUserId: async (userId: string) => CaregiverModel.findOne({ userId: oid(userId) }).lean<Caregiver>(),

  create: async (data: NewCaregiver): Promise<Caregiver> => {
    const doc = await CaregiverModel.create({ ...data, userId: oid(data.userId) });
    return doc.toObject() as Caregiver;
  },

  /** Edit profile fields only while the status is one of `allowed`. Null = not found or status changed. */
  updateWhileIn: async (id: string, allowed: CaregiverStatus[], patch: CaregiverPatch) =>
    CaregiverModel.findOneAndUpdate({ _id: oid(id), status: { $in: allowed } }, { $set: toUpdate(patch) }, { new: true }).lean<Caregiver>(),

  /**
   * Atomic compare-and-set on status. Two coordinators clicking at once: one wins, the other gets null.
   */
  transition: async (id: string, from: CaregiverStatus, to: CaregiverStatus, patch: CaregiverPatch = {}) =>
    CaregiverModel.findOneAndUpdate(
      { _id: oid(id), status: from },
      { $set: { ...toUpdate(patch), status: to } },
      { new: true },
    ).lean<Caregiver>(),

  findPage: async (where: Record<string, unknown>, skip: number, limit: number) =>
    Promise.all([
      CaregiverModel.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).lean<Caregiver[]>(),
      CaregiverModel.countDocuments(where),
    ]),

  /** Approved + available at `at` + serves `area` + has every requested skill. */
  findAssignable: async (skills: string[], area: string, at: Date, limit = 50) => {
    const { dayOfWeek, minute } = toLocalSlot(at);
    const availableIds = await AvailabilityModel.distinct("caregiverId", {
      dayOfWeek,
      startMinute: { $lte: minute },
      endMinute: { $gt: minute },
    });
    if (availableIds.length === 0) return [];
    return CaregiverModel.find({
      _id: { $in: availableIds },
      status: "approved",
      serviceAreas: area,
      ...(skills.length ? { skills: { $all: skills } } : {}),
    })
      .sort({ ratingAverage: -1, ratingCount: -1 })
      .limit(limit)
      .lean<Caregiver[]>();
  },

  /** Running average in ONE atomic update. In a pipeline update, $set reads the pre-update values. */
  applyRating: async (id: string, rating: number) =>
    CaregiverModel.updateOne({ _id: oid(id) }, [
      {
        $set: {
          ratingAverage: {
            $divide: [{ $add: [{ $multiply: ["$ratingAverage", "$ratingCount"] }, rating] }, { $add: ["$ratingCount", 1] }],
          },
          ratingCount: { $add: ["$ratingCount", 1] },
        },
      },
    ]),

  incrementNoShows: async (id: string): Promise<number | null> => {
    const doc = await CaregiverModel.findByIdAndUpdate(id, { $inc: { noShowCount: 1 } }, { new: true }).lean<Caregiver>();
    return doc ? doc.noShowCount : null;
  },

  flagForReview: async (id: string) =>
    CaregiverModel.updateOne({ _id: oid(id), flaggedForReview: false }, { $set: { flaggedForReview: true } }),

  /** true = first time we see this key; false = duplicate delivery. */
  markEventProcessed: async (key: string): Promise<boolean> => {
    try {
      await ProcessedEventModel.create({ _id: key });
      return true;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return false;
      throw err;
    }
  },

  unmarkEventProcessed: async (key: string) => ProcessedEventModel.deleteOne({ _id: key }),

  /** Upsert, so a redelivered visit.checked_in is harmless. */
  recordVisit: async (visitId: string, caregiverId: string) =>
    CaregiverVisitModel.updateOne(
      { _id: visitId },
      { $setOnInsert: { caregiverId: oid(caregiverId) } },
      { upsert: true },
    ),

  findCaregiverIdForVisit: async (visitId: string): Promise<string | null> => {
    const visit = await CaregiverVisitModel.findById(visitId).lean<{ caregiverId: Types.ObjectId }>();
    return visit ? String(visit.caregiverId) : null;
  },
};

/* ------------------------------------------------------------------ */
/* KYC documents                                                       */
/* ------------------------------------------------------------------ */

export type NewKycDocument = {
  caregiverId: string;
  type: KycDocType;
  fileKey: string;
  originalName: string;
  mimeType: string;
  issuedAt?: Date;
  expiresAt?: Date;
};

export type KycDocumentPatch = {
  status?: KycDocStatus;
  reviewNote?: string | null;
  reviewedBy?: string;
  reviewedAt?: Date;
};

export const kycDocumentRepository = {
  create: async (data: NewKycDocument): Promise<KycDocument> => {
    const doc = await KycDocumentModel.create({ ...data, caregiverId: oid(data.caregiverId) });
    return doc.toObject() as KycDocument;
  },

  findById: async (id: string) =>
    Types.ObjectId.isValid(id) ? KycDocumentModel.findById(id).lean<KycDocument>() : null,

  existsByFileKey: async (fileKey: string) => (await KycDocumentModel.exists({ fileKey })) !== null,

  /** Which of `fileKeys` are referenced by a document. */
  findReferencedFileKeys: async (fileKeys: string[]): Promise<Set<string>> =>
    new Set(await KycDocumentModel.distinct("fileKey", { fileKey: { $in: fileKeys } })),

  findByCaregiver: async (caregiverId: string) =>
    KycDocumentModel.find({ caregiverId: oid(caregiverId) }).sort({ createdAt: 1 }).lean<KycDocument[]>(),

  updateById: async (id: string, patch: KycDocumentPatch) =>
    KycDocumentModel.findByIdAndUpdate(
      id,
      { $set: { ...patch, ...(patch.reviewedBy ? { reviewedBy: oid(patch.reviewedBy) } : {}) } },
      { new: true },
    ).lean<KycDocument>(),

  /**
   * Points a document at a new file and sends it back for review. Conditional on `fromStatuses`
   * so a coordinator verifying the document at the same moment cannot be silently overwritten.
   */
  replaceFile: async (
    id: string,
    fromStatuses: KycDocStatus[],
    file: { fileKey: string; originalName: string; mimeType: string; issuedAt?: Date; expiresAt?: Date },
  ) =>
    KycDocumentModel.findOneAndUpdate(
      { _id: oid(id), status: { $in: fromStatuses } },
      {
        $set: {
          ...file,
          status: "pending",
          reviewNote: null,
          reviewedBy: null,
          reviewedAt: null,
        },
      },
      { new: true },
    ).lean<KycDocument>(),

  deleteById: async (id: string) => KycDocumentModel.deleteOne({ _id: oid(id) }),

  deleteByCaregiver: async (caregiverId: string) => KycDocumentModel.deleteMany({ caregiverId: oid(caregiverId) }),

  /** Verified required-type docs whose expiry has passed. */
  findLapsed: async (now: Date) =>
    KycDocumentModel.find({
      status: "verified",
      type: { $in: REQUIRED_KYC_DOC_TYPES },
      expiresAt: { $lte: now },
    }).lean<KycDocument[]>(),
};

/* ------------------------------------------------------------------ */
/* Availability                                                        */
/* ------------------------------------------------------------------ */

export type NewSlot = { dayOfWeek: number; startMinute: number; endMinute: number };

export const availabilityRepository = {
  findByCaregiver: async (caregiverId: string) =>
    AvailabilityModel.find({ caregiverId: oid(caregiverId) })
      .sort({ dayOfWeek: 1, startMinute: 1 })
      .lean<AvailabilitySlot[]>(),

  replaceAll: async (caregiverId: string, slots: NewSlot[]) => {
    await AvailabilityModel.deleteMany({ caregiverId: oid(caregiverId) });
    if (slots.length > 0) {
      await AvailabilityModel.insertMany(slots.map((s) => ({ ...s, caregiverId: oid(caregiverId) })));
    }
  },
};