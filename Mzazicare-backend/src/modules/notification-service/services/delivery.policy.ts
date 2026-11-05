/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import {
  PRIORITIES,
  type Category,
  type Channel,
  type ExternalChannel,
  type NotificationPreference,
  type Priority,
} from "@/modules/notification-service/models/notification.model";

// Nairobi has no DST
const NAIROBI_OFFSET_MIN = 3 * 60;
const DAY_MIN = 24 * 60;

export const DEFAULT_PREFERENCES: Omit<NotificationPreference, "userId"> = {
  push: true,
  sms: true,
  mutedCategories: [],
  quietHoursStart: null,
  quietHoursEnd: null,
};

const CHANNELS_BY_PRIORITY: Record<Priority, ExternalChannel[]> = {
  critical: ["push", "sms"],
  high: ["push", "sms"],
  normal: ["push"],
  low: [],
};

export const higherPriority = (a: Priority, b: Priority | undefined): Priority =>
  b && PRIORITIES.indexOf(b) > PRIORITIES.indexOf(a) ? b : a;

export const minutesUntilQuietHoursEnd = (
  start: number | null,
  end: number | null,
  now: Date,
): number => {
  if (start === null || end === null || start === end) return 0;
  const minute = (now.getUTCHours() * 60 + now.getUTCMinutes() + NAIROBI_OFFSET_MIN) % DAY_MIN;
  const inside = start < end ? minute >= start && minute < end : minute >= start || minute < end;
  if (!inside) return 0;
  return (end - minute + DAY_MIN) % DAY_MIN;
};

export type PlannedDelivery = {
  channel: ExternalChannel;
  status: "queued" | "suppressed";
  reason: string | null;
  delayMs: number;
};

export type DeliveryPlan = {
  channels: Channel[];
  deliveries: PlannedDelivery[];
};

export type PlanInput = {
  priority: Priority;
  category: Category;
  templateChannels?: Channel[];
  preferences: Omit<NotificationPreference, "userId">;
  hasPushDevice: boolean;
  now: Date;
};

export const planDelivery = (input: PlanInput): DeliveryPlan => {
  const { priority, preferences: prefs } = input;
  const critical = priority === "critical";

  let wanted: ExternalChannel[] = critical
    ? ["push", "sms"]
    : input.templateChannels
      ? input.templateChannels.filter((c): c is ExternalChannel => c !== "in_app")
      : CHANNELS_BY_PRIORITY[priority];

  if (priority === "low") wanted = wanted.filter((c) => c !== "sms");
  if (wanted.includes("push") && !input.hasPushDevice) {
    wanted = wanted.filter((c) => c !== "push");
    if ((critical || priority === "high") && !wanted.includes("sms")) wanted.push("sms");
  }

  const delayMs = critical
    ? 0
    : minutesUntilQuietHoursEnd(prefs.quietHoursStart, prefs.quietHoursEnd, input.now) * 60_000;

  const deliveries = wanted.map((channel): PlannedDelivery => {
    if (!critical && prefs.mutedCategories.includes(input.category)) {
      return {
        channel,
        status: "suppressed",
        reason: `category "${input.category}" muted`,
        delayMs: 0,
      };
    }
    if (!critical && !prefs[channel]) {
      return { channel, status: "suppressed", reason: `${channel} turned off`, delayMs: 0 };
    }
    return { channel, status: "queued", reason: null, delayMs };
  });

  return {
    channels: ["in_app", ...deliveries.filter((d) => d.status === "queued").map((d) => d.channel)],
    deliveries,
  };
};
