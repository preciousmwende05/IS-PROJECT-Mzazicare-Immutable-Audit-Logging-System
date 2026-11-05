/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import { Schema, model, type InferSchemaType, type Types } from "mongoose";

export const PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CHANNELS = ["in_app", "push", "sms"] as const;
export type Channel = (typeof CHANNELS)[number];
export type ExternalChannel = Exclude<Channel, "in_app">;
export const EXTERNAL_CHANNELS: readonly ExternalChannel[] = ["push", "sms"];

export const CATEGORIES = [
  "account",
  "kyc",
  "booking",
  "visit",
  "emergency",
  "billing",
  "system",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const ATTEMPT_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "failed",
  "dead",
  "suppressed",
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const DEVICE_PLATFORMS = ["android", "ios", "web"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    templateKey: { type: String, required: true },
    category: { type: String, enum: [...CATEGORIES], required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    smsBody: { type: String, required: true },
    data: { type: Schema.Types.Mixed, default: {} },
    priority: { type: String, enum: [...PRIORITIES], required: true },
    channels: { type: [String], enum: [...CHANNELS], default: ["in_app"] },
    readAt: { type: Date, default: null },
    dedupeKey: { type: String, required: true },
  },
  { timestamps: true, collection: "notifications" },
);

notificationSchema.index({ dedupeKey: 1 }, { unique: true });
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });

export type Notification = InferSchemaType<typeof notificationSchema> & {
  _id: Types.ObjectId;
  priority: Priority;
  category: Category;
  channels: Channel[];
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export const NotificationModel = model("Notification", notificationSchema);

const deliveryAttemptSchema = new Schema(
  {
    notificationId: { type: Schema.Types.ObjectId, ref: "Notification", default: null },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    channel: { type: String, enum: [...EXTERNAL_CHANNELS], required: true },
    priority: { type: String, enum: [...PRIORITIES], required: true },
    status: { type: String, enum: [...ATTEMPT_STATUSES], default: "queued" },
    to: { type: String, default: null },
    text: { type: String, default: null },
    scheduledFor: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    providerId: { type: String, default: null },
    error: { type: String, default: null },
    attemptedAt: { type: Date, default: null },
    dedupeKey: { type: String, required: true },
  },
  { timestamps: true, collection: "delivery_attempts" },
);

deliveryAttemptSchema.index({ dedupeKey: 1 }, { unique: true });
deliveryAttemptSchema.index({ notificationId: 1 });
deliveryAttemptSchema.index({ status: 1, updatedAt: -1 });

export type DeliveryAttempt = InferSchemaType<typeof deliveryAttemptSchema> & {
  _id: Types.ObjectId;
  channel: ExternalChannel;
  priority: Priority;
  status: AttemptStatus;
  createdAt: Date;
  updatedAt: Date;
};

export const DeliveryAttemptModel = model("DeliveryAttempt", deliveryAttemptSchema);

const notificationPreferenceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    push: { type: Boolean, default: true },
    sms: { type: Boolean, default: true },
    mutedCategories: { type: [String], enum: [...CATEGORIES], default: [] },
    // minutes from midnight, Nairobi time
    quietHoursStart: { type: Number, min: 0, max: 1439, default: null },
    quietHoursEnd: { type: Number, min: 0, max: 1439, default: null },
  },
  { timestamps: true, collection: "notification_preferences" },
);

export type NotificationPreference = {
  userId: Types.ObjectId | string;
  push: boolean;
  sms: boolean;
  mutedCategories: Category[];
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
};

export const NotificationPreferenceModel = model(
  "NotificationPreference",
  notificationPreferenceSchema,
);

const deviceTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: [...DEVICE_PLATFORMS], required: true },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: "device_tokens" },
);

export type DeviceToken = InferSchemaType<typeof deviceTokenSchema> & { _id: Types.ObjectId };

export const DeviceTokenModel = model("DeviceToken", deviceTokenSchema);
