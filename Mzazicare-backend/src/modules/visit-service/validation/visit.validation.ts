/**
 * U-CS 73 — Geo-Verified Visit Tracking System
 * Owner(s): Alvin Kimani, Hezekiah Muiruri Munene
 */

import { z } from "zod";

import { VERIFICATION_FLAGS, VISIT_STATUS } from "@/modules/visit-service/models/visit.model";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

// Coordinates

/**
 * Clients send NAMED values, so a position in an array can never be swapped;
 * the service converts to GeoJSON [longitude, latitude]. A client can still put
 * the latitude in the longitude field, which is what the checks below catch.
 *
 * NOT z.coerce.number(): coercion turns `null` and "" into 0, and (0, 0) is a
 * valid point in the Gulf of Guinea that would sail through every range check.
 * A missing coordinate must be an error, not a silent zero.
 */

const invalidLatitudeErrorMessage = "Latitude must be within −90 and 90 degrees";
const invalidLongitudeErrorMessage = "Longitude must be within −180 and 180 degrees";

const latitude = z
  .number()
  .min(-90, invalidLatitudeErrorMessage)
  .max(90, invalidLatitudeErrorMessage);
const longitude = z
  .number()
  .min(-180, invalidLongitudeErrorMessage)
  .max(180, invalidLongitudeErrorMessage);

/**
 * Kenya's bounding coordinates acting as a rough guard to ensure the coordinates
 * are always within Kenya
 */
const KENYA = { minLat: -5, maxLat: 5.5, minLng: 33.5, maxLng: 42.5 } as const;

const inKenya = (lat: number, lng: number) =>
  lat >= KENYA.minLat && lat <= KENYA.maxLat && lng >= KENYA.minLng && lng <= KENYA.maxLng;

/**
 * The shared location fields of check-in, ping and check-out.
 */
const locationFields = {
  latitude,
  longitude,
  /** Device-reported GPS accuracy radius, in metres. */
  accuracyMeters: z.number().finite().min(0).max(100_000).optional(),
  /** Reported by the device.*/
  isMockLocation: z.boolean().default(false),
};

type LocationFields = { latitude: number; longitude: number };

const rejectImplausibleLocation = (value: LocationFields, ctx: z.RefinementCtx) => {
  if (inKenya(value.latitude, value.longitude)) return;

  const looksSwapped = inKenya(value.longitude, value.latitude);
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["latitude"],
    message: looksSwapped
      ? "Location must be in Kenya (are latitude and longitude swapped?)"
      : "Location must be in Kenya",
  });
};

/**
 * Check-in and check-out: location is OPTIONAL (spec: "just a button, optional
 * location"). Send both coordinates or neither — half a location is an error,
 * never a silent zero. Without one, the service accepts the visit but marks it
 * unverified and flags `no_location`.
 */
const optionalLocationFields = {
  ...locationFields,
  latitude: latitude.optional(),
  longitude: longitude.optional(),
};

const rejectHalfOrImplausibleLocation = (
  value: { latitude?: number; longitude?: number },
  ctx: z.RefinementCtx,
) => {
  const hasLat = value.latitude !== undefined;
  const hasLng = value.longitude !== undefined;
  if (!hasLat && !hasLng) return;
  if (hasLat !== hasLng) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [hasLat ? "longitude" : "latitude"],
      message: "Send both latitude and longitude, or neither",
    });
    return;
  }
  rejectImplausibleLocation({ latitude: value.latitude!, longitude: value.longitude! }, ctx);
};

// Time

const CLIENT_CLOCK_SKEW_MS = 5 * 60_000;

const notInFuture = (date: Date) => date.getTime() <= Date.now() + CLIENT_CLOCK_SKEW_MS;

const clientTimestamp = z.coerce.date().refine(notInFuture, "Timestamp is in the future");

// Pagination

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const visitValidation = {
  /** GET / — the caller's visits, filterable by status and date range. */
  list: z.object({
    query: z
      .object({
        status: z.enum(VISIT_STATUS).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        ...pagination,
      })
      .refine((q) => !q.from || !q.to || q.from <= q.to, {
        message: "`from` must not be after `to`",
        path: ["from"],
      }),
  }),

  byId: z.object({
    params: z.object({ id: objectId }),
  }),

  checkIn: z.object({
    params: z.object({ id: objectId }),
    body: z
      .object({
        ...optionalLocationFields,
        offlineRecordedAt: clientTimestamp.optional(),
      })
      .superRefine(rejectHalfOrImplausibleLocation),
  }),

  /** POST /:id/ping — `recordedAt` is the client's clock; the server stamps `receivedAt`. */
  ping: z.object({
    params: z.object({ id: objectId }),
    body: z
      .object({
        ...locationFields,
        recordedAt: clientTimestamp,
      })
      .superRefine(rejectImplausibleLocation),
  }),

  /** POST /:id/check-out */
  checkOut: z.object({
    params: z.object({ id: objectId }),
    body: z.object(optionalLocationFields).superRefine(rejectHalfOrImplausibleLocation),
  }),

  /** POST /:id/dispute — the family challenges a visit. */
  dispute: z.object({
    params: z.object({ id: objectId }),
    body: z.object({
      reason: z.string().trim().min(10, "Please state what is not correct.").max(1000),
    }),
  }),

  /** POST /:id/resolve-dispute */
  resolveDispute: z.object({
    params: z.object({ id: objectId }),
    body: z.object({
      resolution: z.enum(["uphold", "void"]),
    }),
  }),

  /** GET /active — coordinator: visits in progress right now. */
  active: z.object({
    query: z.object(pagination),
  }),

  /** GET /flagged — coordinator: visits carrying verification flags. */
  flagged: z.object({
    query: z.object({
      flag: z.enum(VERIFICATION_FLAGS).optional(),
      ...pagination,
    }),
  }),
};

export type ListVisitsQuery = z.infer<typeof visitValidation.list>["query"];
export type CheckInInput = z.infer<typeof visitValidation.checkIn>["body"];
export type PingInput = z.infer<typeof visitValidation.ping>["body"];
export type CheckOutInput = z.infer<typeof visitValidation.checkOut>["body"];
export type DisputeInput = z.infer<typeof visitValidation.dispute>["body"];
export type ResolveDisputeInput = z.infer<typeof visitValidation.resolveDispute>["body"];
export type FlaggedVisitsQuery = z.infer<typeof visitValidation.flagged>["query"];
