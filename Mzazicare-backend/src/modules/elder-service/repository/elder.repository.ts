/**
 * U-CS 68 — Digital Elder Profile & Care Data System
 * Owner(s): Ian Omwenga, Mepani Bhavin Ramesh
 */

import type { Types } from "mongoose";

import {
  CareCircleMemberModel,
  CarePlanModel,
  ElderModel,
  EmergencyContactModel,
  type CareCircleMember,
  type CarePlan,
  type Elder,
  type EmergencyContact,
  type NewCareCircleMember,
  type NewElder,
} from "@/modules/elder-service/models/elder.model";

/**
 * The only layer allowed to touch the database.
 *
 * Repositories answer data questions:
 *
 *   "find these records"
 *   "create this record"
 *   "update this record"
 *
 * They do NOT decide:
 *
 *   - who is authorized
 *   - who owns an elder
 *   - whether a caregiver has an active booking
 *   - whether the last owner may be removed
 *   - whether an operation is permitted
 */

export const elderRepository = {
  // ===========================================================================
  // Elder profile
  // ===========================================================================

  findById: async (
    id: string,
  ): Promise<Elder | null> =>
    ElderModel
      .findById(id)
      .lean<Elder>(),

  create: async (
    data: NewElder,
  ): Promise<Elder> => {
    const doc =
      await ElderModel.create(data);

    return doc.toObject() as Elder;
  },

  update: async (
    id: string,
    patch: Partial<NewElder>,
  ): Promise<Elder | null> =>
    ElderModel
      .findByIdAndUpdate(
        id,
        patch,
        {
          new: true,
          runValidators: true,
        },
      )
      .lean<Elder>(),

  /**
   * Kept for compatibility with the existing repository API.
   *
   * U-CS 68 business rules should not use this to remove an elder.
   * Deceased elders are represented through status = "deceased".
   */
  delete: async (
    id: string,
  ): Promise<void> => {
    await ElderModel.findByIdAndDelete(id);
  },

  // ===========================================================================
  // Elder listing / circles
  // ===========================================================================

  /**
   * Accepted memberships only.
   *
   * A pending invitation grants no access.
   */
  findCirclesForUser: async (
    userId: string,
  ): Promise<CareCircleMember[]> =>
    CareCircleMemberModel
      .find({
        userId,
        acceptedAt: {
          $ne: null,
        },
      })
      .lean<CareCircleMember[]>(),

  findCircleMember: async (
    elderId: string,
    userId: string,
  ): Promise<CareCircleMember | null> =>
    CareCircleMemberModel
      .findOne({
        elderId,
        userId,
        acceptedAt: {
          $ne: null,
        },
      })
      .lean<CareCircleMember>(),

  /**
   * One page of elders, newest first, plus total count.
   * `ids` limits the page to those elders (a caller's care circles); null
   * means every elder (staff). `q` matches name, estate or county.
   */
  findPageByIds: async (
    ids: Types.ObjectId[] | null,
    skip: number,
    limit: number,
    q?: string,
  ): Promise<[Elder[], number]> => {
    const where: Record<string, unknown> = {};
    if (ids) where._id = { $in: ids };
    if (q) {
      const pattern = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
      where.$or = [
        { firstName: pattern },
        { lastName: pattern },
        { "address.estate": pattern },
        { "address.county": pattern },
      ];
    }

    return Promise.all([
      ElderModel
        .find(where)
        .sort({
          _id: -1,
        })
        .skip(skip)
        .limit(limit)
        .lean<Elder[]>(),

      ElderModel.countDocuments(where),
    ]);
  },

  // ===========================================================================
  // Care plans
  // ===========================================================================

  /**
   * Highest version = current care plan.
   *
   * No previous version is overwritten.
   */
  findCurrentCarePlan: async (
    elderId: string,
  ): Promise<CarePlan | null> =>
    CarePlanModel
      .findOne({
        elderId,
      })
      .sort({
        version: -1,
      })
      .lean<CarePlan>(),

  findCarePlanHistory: async (
    elderId: string,
    skip: number,
    limit: number,
  ): Promise<[CarePlan[], number]> => {
    const where = {
      elderId,
    };

    return Promise.all([
      CarePlanModel
        .find(where)
        .sort({
          version: -1,
        })
        .skip(skip)
        .limit(limit)
        .lean<CarePlan[]>(),

      CarePlanModel.countDocuments(where),
    ]);
  },

  findLatestCarePlanVersion: async (
    elderId: string,
  ): Promise<number> => {
    const latest =
      await CarePlanModel
        .findOne({
          elderId,
        })
        .sort({
          version: -1,
        })
        .select({
          version: 1,
        })
        .lean<{
          version: number;
        }>();

    return latest?.version ?? 0;
  },

  /**
   * Creates a completely new care-plan document.
   *
   * Existing versions remain untouched.
   */
  createCarePlanVersion: async (
    data: Omit<
      CarePlan,
      "_id" | "createdAt" | "updatedAt"
    >,
  ): Promise<CarePlan> => {
    const doc =
      await CarePlanModel.create(data);

    return doc.toObject() as CarePlan;
  },

  // ===========================================================================
  // Care circle
  // ===========================================================================

  addCircleMember: async (
    data: NewCareCircleMember,
  ): Promise<CareCircleMember> => {
    const doc =
      await CareCircleMemberModel.create(data);

    return doc.toObject() as CareCircleMember;
  },

  /**
   * Returns all members, including pending invitations.
   *
   * This is intentional for the care-circle management endpoint.
   */
  findCircleMembers: async (
    elderId: string,
  ): Promise<CareCircleMember[]> =>
    CareCircleMemberModel
      .find({
        elderId,
      })
      .sort({
        createdAt: 1,
      })
      .lean<CareCircleMember[]>(),

  /**
   * Used to detect duplicate membership/invitation.
   */
  findCircleMemberByUser: async (
    elderId: string,
    userId: string,
  ): Promise<CareCircleMember | null> =>
    CareCircleMemberModel
      .findOne({
        elderId,
        userId,
      })
      .lean<CareCircleMember>(),

  updateCircleMemberAccess: async (
    elderId: string,
    userId: string,
    accessLevel: CareCircleMember["accessLevel"],
  ): Promise<CareCircleMember | null> =>
    CareCircleMemberModel
      .findOneAndUpdate(
        {
          elderId,
          userId,
        },
        {
          $set: {
            accessLevel,
          },
        },
        {
          new: true,
          runValidators: true,
        },
      )
      .lean<CareCircleMember>(),

  /** Marks a pending invitation accepted. Null when there is no pending one. */
  acceptCircleMember: async (
    elderId: string,
    userId: string,
  ): Promise<CareCircleMember | null> =>
    CareCircleMemberModel
      .findOneAndUpdate(
        {
          elderId,
          userId,
          acceptedAt: null,
        },
        {
          $set: {
            acceptedAt: new Date(),
          },
        },
        {
          new: true,
        },
      )
      .lean<CareCircleMember>(),

  removeCircleMember: async (
    elderId: string,
    userId: string,
  ): Promise<boolean> => {
    const result =
      await CareCircleMemberModel.deleteOne({
        elderId,
        userId,
      });

    return result.deletedCount > 0;
  },

  /**
   * Counts accepted owners only.
   *
   * The service uses this to prevent removal of the final owner.
   */
  countAcceptedOwners: async (
    elderId: string,
  ): Promise<number> =>
    CareCircleMemberModel.countDocuments({
      elderId,
      accessLevel: "owner",
      acceptedAt: {
        $ne: null,
      },
    }),

  // ===========================================================================
  // Emergency contacts
  // ===========================================================================

  findEmergencyContacts: async (
    elderId: string,
  ): Promise<EmergencyContact[]> =>
    EmergencyContactModel
      .find({
        elderId,
      })
      .sort({
        priority: 1,
      })
      .lean<EmergencyContact[]>(),

  createEmergencyContact: async (
    data: Omit<
      EmergencyContact,
      "_id" | "createdAt" | "updatedAt"
    >,
  ): Promise<EmergencyContact> => {
    const doc =
      await EmergencyContactModel.create(data);

    return doc.toObject() as EmergencyContact;
  },

  // ===========================================================================
  // Data rights (Kenya Data Protection Act): export and erasure
  // ===========================================================================

  /** Every care-plan version, oldest first, for a data export. */
  findAllCarePlans: async (elderId: string): Promise<CarePlan[]> =>
    CarePlanModel.find({ elderId }).sort({ version: 1 }).lean<CarePlan[]>(),

  /**
   * Erase an elder's personal data after an APPROVED deletion request. The
   * elder document stays (visits, care logs and audit rows point at it) but no
   * longer identifies anyone: names replaced, birth date and address details
   * dropped, home location coarsened to about 11 km. Care plans, emergency
   * contacts and the care circle are deleted.
   */
  eraseElderPersonalData: async (elderId: string): Promise<void> => {
    const elder = await ElderModel.findById(elderId).lean<Elder>();
    if (!elder) return;
    const [lng, lat] = (elder.homeLocation?.coordinates ?? [0, 0]) as number[];
    const coarse = (n: number | undefined) => Math.round((n ?? 0) * 10) / 10;
    await ElderModel.updateOne(
      { _id: elderId },
      {
        $set: {
          firstName: "Erased",
          lastName: "record",
          dateOfBirth: new Date("1900-01-01T00:00:00Z"),
          gender: "other",
          photoKey: null,
          "homeLocation.coordinates": [coarse(lng), coarse(lat)],
          status: "inactive",
          erasedAt: new Date(),
        },
        $unset: { "address.estate": "", "address.street": "", "address.landmark": "" },
      },
    );
    await Promise.all([
      CarePlanModel.deleteMany({ elderId }),
      EmergencyContactModel.deleteMany({ elderId }),
      CareCircleMemberModel.deleteMany({ elderId }),
    ]);
  },
};