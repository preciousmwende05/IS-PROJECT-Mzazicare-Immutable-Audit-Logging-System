/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import type {
  DeliveryAttempt,
  Notification,
  NotificationPreference,
} from "@/modules/notification-service/models/notification.model";

export type NotificationView = {
  id: string;
  templateKey: string;
  category: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  priority: string;
  read: boolean;
  readAt: string | null;
  createdAt: string;
};

export const serializeNotification = (n: Notification): NotificationView => ({
  id: String(n._id),
  templateKey: n.templateKey,
  category: n.category,
  title: n.title,
  body: n.body,
  data: n.data ?? {},
  priority: n.priority,
  read: !!n.readAt,
  readAt: n.readAt ? n.readAt.toISOString() : null,
  createdAt: n.createdAt.toISOString(),
});

export type PreferencesView = {
  push: boolean;
  sms: boolean;
  mutedCategories: string[];
  quietHours: { start: number; end: number } | null;
};

export const serializePreferences = (
  p: Omit<NotificationPreference, "userId">,
): PreferencesView => ({
  push: p.push,
  sms: p.sms,
  mutedCategories: p.mutedCategories,
  quietHours:
    p.quietHoursStart !== null && p.quietHoursEnd !== null
      ? { start: p.quietHoursStart, end: p.quietHoursEnd }
      : null,
});

export type DeliveryAttemptView = {
  id: string;
  notificationId: string | null;
  userId: string | null;
  channel: string;
  priority: string;
  status: string;
  to: string | null;
  attempts: number;
  providerId: string | null;
  error: string | null;
  scheduledFor: string | null;
  attemptedAt: string | null;
  updatedAt: string;
};

const maskPhone = (phone: string) =>
  phone.length > 4 ? `${"*".repeat(phone.length - 3)}${phone.slice(-3)}` : "***";

export const serializeDeliveryAttempt = (a: DeliveryAttempt): DeliveryAttemptView => ({
  id: String(a._id),
  notificationId: a.notificationId ? String(a.notificationId) : null,
  userId: a.userId ? String(a.userId) : null,
  channel: a.channel,
  priority: a.priority,
  status: a.status,
  to: a.to ? maskPhone(a.to) : null,
  attempts: a.attempts,
  providerId: a.providerId ?? null,
  error: a.error ?? null,
  scheduledFor: a.scheduledFor ? a.scheduledFor.toISOString() : null,
  attemptedAt: a.attemptedAt ? a.attemptedAt.toISOString() : null,
  updatedAt: a.updatedAt.toISOString(),
});
