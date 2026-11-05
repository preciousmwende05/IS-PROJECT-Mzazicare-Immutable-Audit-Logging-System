/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import { z } from "zod";

import {
  CATEGORIES,
  DEVICE_PLATFORMS,
} from "@/modules/notification-service/models/notification.model";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const minuteOfDay = z.number().int().min(0).max(1439);

const mutableCategory = z
  .enum(CATEGORIES)
  .refine((c) => c !== "emergency", "Emergency notifications cannot be muted");

const preferencesBody = z
  .object({
    push: z.boolean().optional(),
    sms: z.boolean().optional(),
    mutedCategories: z.array(mutableCategory).max(CATEGORIES.length).optional(),
    quietHours: z
      .object({ start: minuteOfDay, end: minuteOfDay })
      .refine((q) => q.start !== q.end, "start and end must differ")
      .nullable()
      .optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one preference to update");

export type PreferencesInput = z.infer<typeof preferencesBody>;

const page = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const notificationValidation = {
  list: z.object({
    query: z.object({
      ...page,
      unread: z
        .enum(["true", "false"])
        .optional()
        .transform((v) => v === "true"),
    }),
  }),

  page: z.object({ query: z.object(page) }),

  byId: z.object({
    params: z.object({ id: objectId }),
  }),

  updatePreferences: z.object({ body: preferencesBody }),

  stream: z.object({
    query: z.object({
      ticket: z.string().min(16).max(128),
      lastEventId: z.string().max(64).optional(),
    }),
  }),

  registerDevice: z.object({
    body: z
      .object({
        token: z.string().trim().min(10).max(4096),
        platform: z.enum(DEVICE_PLATFORMS),
      })
      .strict(),
  }),

  unregisterDevice: z.object({
    params: z.object({ token: z.string().min(10).max(4096) }),
  }),
};
