/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import { Types } from "mongoose";

import {
  DeliveryAttemptModel,
  DeviceTokenModel,
  NotificationModel,
  NotificationPreferenceModel,
  type AttemptStatus,
  type Category,
  type Channel,
  type DeliveryAttempt,
  type DevicePlatform,
  type DeviceToken,
  type ExternalChannel,
  type Notification,
  type NotificationPreference,
  type Priority,
} from "@/modules/notification-service/models/notification.model";

const oid = (id: string) => new Types.ObjectId(id);
const isDuplicateKey = (err: unknown) => (err as { code?: number }).code === 11000;

export type NewNotification = {
  userId: string;
  templateKey: string;
  category: Category;
  title: string;
  body: string;
  smsBody: string;
  data: Record<string, unknown>;
  priority: Priority;
  channels: Channel[];
  dedupeKey: string;
};

export type NewAttempt = {
  notificationId: string | null;
  userId: string | null;
  channel: ExternalChannel;
  priority: Priority;
  status: AttemptStatus;
  to?: string | null;
  text?: string | null;
  scheduledFor?: Date | null;
  error?: string | null;
  dedupeKey: string;
};

export const notificationRepository = {
  createOnce: async (
    data: NewNotification,
  ): Promise<{ notification: Notification; created: boolean }> => {
    try {
      const doc = await NotificationModel.create({ ...data, userId: oid(data.userId) });
      return { notification: doc.toObject() as Notification, created: true };
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      const existing = await NotificationModel.findOne({
        dedupeKey: data.dedupeKey,
      }).lean<Notification>();
      if (!existing) throw err;
      return { notification: existing, created: false };
    }
  },

  findById: async (id: string) =>
    Types.ObjectId.isValid(id) ? NotificationModel.findById(id).lean<Notification>() : null,

  findPageForUser: async (userId: string, unreadOnly: boolean, skip: number, limit: number) => {
    const where = { userId: oid(userId), ...(unreadOnly ? { readAt: null } : {}) };
    return Promise.all([
      NotificationModel.find(where)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<Notification[]>(),
      NotificationModel.countDocuments(where),
    ]);
  },

  findForUserAfter: async (userId: string, afterId: string, limit: number) =>
    Types.ObjectId.isValid(afterId)
      ? NotificationModel.find({ userId: oid(userId), _id: { $gt: oid(afterId) } })
          .sort({ _id: 1 })
          .limit(limit)
          .lean<Notification[]>()
      : [],

  countUnread: async (userId: string) =>
    NotificationModel.countDocuments({ userId: oid(userId), readAt: null }),

  markRead: async (id: string, userId: string) =>
    NotificationModel.findOneAndUpdate(
      { _id: oid(id), userId: oid(userId) },
      [{ $set: { readAt: { $ifNull: ["$readAt", "$$NOW"] } } }],
      { new: true },
    ).lean<Notification>(),

  markAllRead: async (userId: string) => {
    const result = await NotificationModel.updateMany(
      { userId: oid(userId), readAt: null },
      { $set: { readAt: new Date() } },
    );
    return result.modifiedCount;
  },
};

export const deliveryAttemptRepository = {
  createOnce: async (data: NewAttempt): Promise<DeliveryAttempt> => {
    const doc = await DeliveryAttemptModel.findOneAndUpdate(
      { dedupeKey: data.dedupeKey },
      {
        $setOnInsert: {
          ...data,
          notificationId: data.notificationId ? oid(data.notificationId) : null,
          userId: data.userId ? oid(data.userId) : null,
        },
      },
      { upsert: true, new: true },
    ).lean<DeliveryAttempt>();
    return doc!;
  },

  findById: async (id: string) =>
    Types.ObjectId.isValid(id) ? DeliveryAttemptModel.findById(id).lean<DeliveryAttempt>() : null,

  findByNotification: async (notificationId: string) =>
    DeliveryAttemptModel.find({ notificationId: oid(notificationId) })
      .sort({ createdAt: 1 })
      .lean<DeliveryAttempt[]>(),

  findPageByStatus: async (status: AttemptStatus, skip: number, limit: number) =>
    Promise.all([
      DeliveryAttemptModel.find({ status })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<DeliveryAttempt[]>(),
      DeliveryAttemptModel.countDocuments({ status }),
    ]),

  recordSent: async (id: string, providerId: string | null) =>
    DeliveryAttemptModel.updateOne(
      { _id: oid(id) },
      {
        $set: { status: "sent", providerId, error: null, attemptedAt: new Date() },
        $inc: { attempts: 1 },
      },
    ),

  recordFailure: async (id: string, error: string) =>
    DeliveryAttemptModel.updateOne(
      { _id: oid(id) },
      { $set: { status: "failed", error, attemptedAt: new Date() }, $inc: { attempts: 1 } },
    ),

  setStatus: async (id: string, status: AttemptStatus, error: string | null = null) =>
    DeliveryAttemptModel.updateOne({ _id: oid(id) }, { $set: { status, error } }),
};

export const preferenceRepository = {
  findByUser: async (userId: string) =>
    NotificationPreferenceModel.findOne({ userId: oid(userId) }).lean<NotificationPreference>(),

  upsert: async (userId: string, patch: Partial<Omit<NotificationPreference, "userId">>) =>
    NotificationPreferenceModel.findOneAndUpdate(
      { userId: oid(userId) },
      { $set: patch, $setOnInsert: { userId: oid(userId) } },
      { upsert: true, new: true, runValidators: true },
    ).lean<NotificationPreference>(),
};

export const deviceTokenRepository = {
  upsert: async (userId: string, token: string, platform: DevicePlatform) =>
    DeviceTokenModel.findOneAndUpdate(
      { token },
      { $set: { userId: oid(userId), platform, lastSeenAt: new Date() } },
      { upsert: true, new: true },
    ).lean<DeviceToken>(),

  tokensForUser: async (userId: string): Promise<string[]> =>
    (
      await DeviceTokenModel.find({ userId: oid(userId) }, { token: 1 }).lean<{ token: string }[]>()
    ).map((d) => d.token),

  hasAny: async (userId: string) =>
    (await DeviceTokenModel.exists({ userId: oid(userId) })) !== null,

  removeForUser: async (userId: string, token: string) =>
    (await DeviceTokenModel.deleteOne({ userId: oid(userId), token })).deletedCount,

  removeMany: async (tokens: string[]) => DeviceTokenModel.deleteMany({ token: { $in: tokens } }),
};
