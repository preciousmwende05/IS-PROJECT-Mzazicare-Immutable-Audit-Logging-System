/**
 * U-CS 73 — Geo-Verified Visit Tracking System
 * Owner(s): Alvin Kimani, Hezekiah Muiruri Munene
 */

import { Schema, model, type InferSchemaType, type HydratedDocument, type Types } from "mongoose";

import { DAY_MS } from "@/shared/utils/date.util";

/** Lifecycle states of a visit */
export const VISIT_STATUS = [
  "scheduled",
  "en_route",
  "checked_in",
  "in_progress",
  "checked_out",
  "completed",
  "missed",
  "abandoned",
  "disputed",
  "voided",
] as const;

/** Reasons for flagging a visit. */
export const VERIFICATION_FLAGS = [
  "outside_geofence",
  "mock_location",
  "late_checkin",
  "offline_sync",
  "short_visit",
  // Checked in or out without sharing a location (allowed; never verified).
  "no_location",
] as const;

/** How long a location ping is kept */
export const PING_RETENTION_DAYS = 90;

/** GeoJSON Point, [longitude, latitude] */
const geoPointSchema = new Schema(
  {
    type: { type: String, enum: ["Point"], default: "Point", required: true },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (v: number[]) => {
          const [lng, lat] = v;
          return (
            v.length === 2 &&
            lng !== undefined &&
            lat !== undefined &&
            lng >= -180 &&
            lng <= 180 &&
            lat >= -90 &&
            lat <= 90
          );
        },
        message: "coordinates must be [longitude, latitude] within valid ranges",
      },
    },
  },
  { _id: false },
);

const visitSchema = new Schema(
  {
    // One visit per booking with a unique index
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true, unique: true },
    caregiverId: { type: Schema.Types.ObjectId, ref: "Caregiver", required: true },
    elderId: { type: Schema.Types.ObjectId, ref: "Elder", required: true },

    // The elder's home copied at creation so later profile edits cannot move the fence.
    expectedLocation: { type: geoPointSchema, required: true },
    geofenceRadiusMeters: { type: Number, default: 150, min: 1 },
    scheduledFor: { type: Date, required: true },
    expectedDurationMinutes: { type: Number, required: true, min: 1 },
    status: { type: String, enum: VISIT_STATUS, default: "scheduled" },

    checkInAt: { type: Date }, // server time
    checkInLocation: { type: geoPointSchema },
    checkInDistanceMeters: { type: Number, min: 0 },
    checkInVerified: { type: Boolean, default: false },

    checkOutAt: { type: Date },
    checkOutLocation: { type: geoPointSchema },
    checkOutDistanceMeters: { type: Number, min: 0 },
    checkOutVerified: { type: Boolean, default: false },

    actualDurationMinutes: { type: Number, min: 0 },

    verificationFlags: { type: [{ type: String, enum: VERIFICATION_FLAGS }], default: [] },
    disputeReason: { type: String, trim: true },
  },
  { timestamps: true, collection: "visits" },
);

const geoIndex = "2dsphere";

// Indexes
visitSchema.index({ caregiverId: 1, scheduledFor: -1 });
visitSchema.index({ elderId: 1, scheduledFor: -1 });
visitSchema.index({ status: 1, scheduledFor: 1 });
visitSchema.index({ verificationFlags: 1 });
visitSchema.index({ expectedLocation: geoIndex });
visitSchema.index({ checkInLocation: geoIndex });
visitSchema.index({ checkOutLocation: geoIndex });

export type Visit = InferSchemaType<typeof visitSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export type NewVisit = InferSchemaType<typeof visitSchema>;
export type VisitDocument = HydratedDocument<Visit>;
export type VisitStatus = (typeof VISIT_STATUS)[number];
export type VerificationFlag = (typeof VERIFICATION_FLAGS)[number];

export const VisitModel = model("Visit", visitSchema);

const locationPingSchema = new Schema(
  {
    visitId: { type: Schema.Types.ObjectId, ref: "Visit", required: true },
    location: { type: geoPointSchema, required: true },
    recordedAt: { type: Date, required: true },
    receivedAt: { type: Date, default: () => new Date() }, // server clock
    accuracyMeters: { type: Number, min: 0 },
    isMockLocation: { type: Boolean, default: false },

    // opening a visit dispute unsets `expiresAt` on the visit's pings
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + PING_RETENTION_DAYS * DAY_MS),
    },
  },
  { timestamps: false, collection: "location_pings" },
);

// Indexes
locationPingSchema.index({ visitId: 1, recordedAt: 1 });
locationPingSchema.index({ location: geoIndex });
locationPingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type LocationPing = InferSchemaType<typeof locationPingSchema> & { _id: Types.ObjectId };
export type NewLocationPing = InferSchemaType<typeof locationPingSchema>;
export type LocationPingDocument = HydratedDocument<LocationPing>;

export const LocationPingModel = model("LocationPing", locationPingSchema);
