/**
 * U-CS 73 — Geo-Verified Visit Tracking System
 * Owner(s): Alvin Kimani, Hezekiah Muiruri Munene
 */

import type { FilterQuery, UpdateQuery } from "mongoose";

import {
  LocationPingModel,
  VERIFICATION_FLAGS,
  VisitModel,
  type LocationPing,
  type NewLocationPing,
  type VerificationFlag,
  type Visit,
  type VisitStatus,
} from "@/modules/visit-service/models/visit.model";
import type { GeoPoint } from "@/shared/types";
import { addMinutes } from "@/shared/utils/date.util";

export type NewVisitSeed = {
  bookingId: string;
  caregiverId: string;
  elderId: string;
  expectedLocation: GeoPoint;
  scheduledFor: Date;
  expectedDurationMinutes: number;
};

/** The fields a status transition writes. */
export type VisitPatch = UpdateQuery<Visit>["$set"];

export type VisitFilter = {
  caregiverId?: string;
  elderIds?: string[];
  statuses?: VisitStatus[];
  scheduledFrom?: Date;
  scheduledTo?: Date;
  flag?: VerificationFlag;
  flagged?: boolean;
};

const buildWhere = (filter: VisitFilter): FilterQuery<Visit> => {
  const where: FilterQuery<Visit> = {};

  if (filter.caregiverId) where.caregiverId = filter.caregiverId;
  if (filter.elderIds) where.elderId = { $in: filter.elderIds };
  if (filter.statuses) where.status = { $in: filter.statuses };

  if (filter.scheduledFrom || filter.scheduledTo) {
    where.scheduledFor = {
      ...(filter.scheduledFrom && { $gte: filter.scheduledFrom }),
      ...(filter.scheduledTo && { $lte: filter.scheduledTo }),
    };
  }

  if (filter.flag) where.verificationFlags = filter.flag;
  else if (filter.flagged) where.verificationFlags = { $in: [...VERIFICATION_FLAGS] };

  return where;
};

const AWAITING_ARRIVAL: VisitStatus[] = ["scheduled", "en_route"];

// MongoDB error code for a unique index write violation
const MONGO_DUPLICATE_KEY = 11000;
const isDuplicateKey = (err: unknown) => (err as { code?: number })?.code === MONGO_DUPLICATE_KEY;

export const visitRepository = {
  // Visits — reads
  findById: async (id: string): Promise<Visit | null> => VisitModel.findById(id).lean<Visit>(),

  findByBookingId: async (bookingId: string): Promise<Visit | null> =>
    VisitModel.findOne({ bookingId }).lean<Visit>(),

  findElderIdById: async (id: string): Promise<string | null> => {
    const visit = await VisitModel.findById(id).select("elderId").lean<Pick<Visit, "elderId">>();
    return visit ? String(visit.elderId) : null;
  },

  /** returns newest scheduled time first.*/
  findPage: async (
    filter: VisitFilter,
    skip: number,
    limit: number,
  ): Promise<[Visit[], number]> => {
    const where = buildWhere(filter);
    return Promise.all([
      VisitModel.find(where).sort({ scheduledFor: -1 }).skip(skip).limit(limit).lean<Visit[]>(),
      VisitModel.countDocuments(where),
    ]);
  },

  // missed visit sweep. `excludeIds` lets one sweep pass skip visits it has alread looked at
  findDueForMissedSweep: async (
    graceMinutes: number,
    now: Date = new Date(),
    limit = 100,
    excludeIds: string[] = [],
  ): Promise<Visit[]> =>
    VisitModel.find({
      status: { $in: AWAITING_ARRIVAL },
      scheduledFor: { $lt: addMinutes(now, -graceMinutes) },
      ...(excludeIds.length && { _id: { $nin: excludeIds } }),
    })
      .sort({ scheduledFor: 1 })
      .limit(limit)
      .lean<Visit[]>(),

  // Visits — writes

  // Insert the visit for a booking unless one exists. Safe to call twice.
  createOnce: async (data: NewVisitSeed): Promise<{ visit: Visit; created: boolean }> => {
    try {
      const doc = await VisitModel.create(data);
      return { visit: doc.toObject() as Visit, created: true };
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      const existing = await VisitModel.findOne({ bookingId: data.bookingId }).lean<Visit>();
      if (!existing) throw err;
      return { visit: existing, created: false };
    }
  },

  // Returns the updated visit, or `null` when the visit does not exist or is not in `from`.
  // `unset` clears fields, which is how a failed check-in or check-out is rolled back.
  transition: async (
    id: string,
    from: VisitStatus[],
    patch: VisitPatch,
    unset: (keyof Visit)[] = [],
  ): Promise<Visit | null> =>
    VisitModel.findOneAndUpdate(
      { _id: id, status: { $in: from } },
      {
        $set: patch,
        ...(unset.length && { $unset: Object.fromEntries(unset.map((field) => [field, 1])) }),
      },
      { new: true, runValidators: true },
    ).lean<Visit>(),

  transitionByBookingId: async (
    bookingId: string,
    from: VisitStatus[],
    patch: VisitPatch,
  ): Promise<Visit | null> =>
    VisitModel.findOneAndUpdate(
      { bookingId, status: { $in: from } },
      { $set: patch },
      { new: true, runValidators: true },
    ).lean<Visit>(),

  // Location pings

  // `receivedAt` and `expiresAt` are stamped by the schema, never by the caller
  createPing: async (
    data: Omit<NewLocationPing, "receivedAt" | "expiresAt">,
  ): Promise<LocationPing> => {
    const doc = await LocationPingModel.create(data);
    return doc.toObject() as LocationPing;
  },

  // A visit's latest pings, newest first

  findRecentPings: async (visitId: string, limit: number): Promise<LocationPing[]> =>
    LocationPingModel.find({ visitId })
      .sort({ recordedAt: -1 })
      .limit(limit)
      .lean<LocationPing[]>(),

  // Keep this visit's pings for evidence in a dispute
  holdPingsForDispute: async (visitId: string): Promise<number> => {
    const result = await LocationPingModel.updateMany({ visitId }, { $unset: { expiresAt: 1 } });
    return result.modifiedCount;
  },
};
