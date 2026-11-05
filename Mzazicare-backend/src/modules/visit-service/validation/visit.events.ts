/**
 * U-CS 73 — Geo-Verified Visit Tracking System
 * Owner(s): Alvin Kimani, Hezekiah Muiruri Munene
 */

import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const bookingConfirmedPayload = z.object({
  bookingId: objectId,
  caregiverId: objectId,
  elderId: objectId,
  scheduledFor: z.coerce.date(),
  durationMinutes: z.number().int().min(1),
  location: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  }),
});

export type BookingConfirmedPayload = z.infer<typeof bookingConfirmedPayload>;
