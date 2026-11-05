/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import type {
  Category,
  Channel,
  Priority,
} from "@/modules/notification-service/models/notification.model";

export type TemplateData = Record<string, unknown>;

export type Rendered = {
  title: string;
  body: string;
  sms: string;
};

export type Template = {
  category: Category;
  priority: Priority;
  channels?: Channel[];
  render(data: TemplateData): Rendered;
};

const nairobiTime = new Intl.DateTimeFormat("en-KE", {
  timeZone: "Africa/Nairobi",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export const when = (value: unknown): string => {
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : nairobiTime.format(date);
};

export const kesFromCents = (value: unknown): string => {
  const cents = Number(value);
  return Number.isFinite(cents)
    ? `KES ${(cents / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`
    : "";
};

export const forAmount = (cents: unknown): string => {
  const formatted = kesFromCents(cents);
  return formatted ? ` for ${formatted}` : "";
};

export const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

export const onTime = (value: unknown): string => {
  const formatted = when(value);
  return formatted ? ` on ${formatted}` : "";
};
