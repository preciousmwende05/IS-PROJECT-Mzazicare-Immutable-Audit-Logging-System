/**
 * U-CS 68 — Digital Elder Profile & Care Data System
 * Owner(s): Ian Omwenga, Mepani Bhavin Ramesh
 */

import { Schema, model, type InferSchemaType, type HydratedDocument, type Types } from "mongoose";

export const ELDER_GENDERS = ["male", "female", "other"] as const;
export const ELDER_STATUSES = ["active", "inactive", "deceased"] as const;
export const CIRCLE_ACCESS_LEVELS = ["owner", "editor", "viewer"] as const;
export const MOBILITY_LEVELS = ["independent", "walker", "wheelchair", "bedbound"] as const;


// Elder → collection `elders`

const elderSchema = new Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    // Age is derived from this on read, never stored.
    dateOfBirth: { type: Date, required: true },
    gender: { type: String, enum: ELDER_GENDERS, required: true },
    // A storage key, never a URL: clients only ever get a signed URL.
    photoKey: { type: String, default: null },
    // GeoJSON order is [longitude, latitude]. visit-service geofences against it.
    homeLocation: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], required: true },
    },
    address: {
      estate: { type: String, trim: true },
      street: { type: String, trim: true },
      landmark: { type: String, trim: true },
      county: { type: String, trim: true, required: true },
    },
    // The family member who created the record.
    primaryContactUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Deceased is a status, not a delete: bookings, invoices and audit rows still point here.
    status: { type: String, enum: ELDER_STATUSES, default: "active" },
    // Set when an approved data-deletion request erased the personal data
    // (Kenya Data Protection Act). The record stays so visits and audit rows
    // still resolve, but it no longer identifies anyone.
    erasedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "elders" },
);

elderSchema.index({ homeLocation: "2dsphere" });

export type Elder = InferSchemaType<typeof elderSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export type NewElder = Omit<InferSchemaType<typeof elderSchema>, "createdAt" | "updatedAt">;
export type ElderDocument = HydratedDocument<Elder>;

export const ElderModel = model("Elder", elderSchema);


// CareCircleMember → collection `care_circle_members`

const careCircleMemberSchema = new Schema(
  {
    elderId: { type: Schema.Types.ObjectId, ref: "Elder", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    relationship: { type: String, trim: true, default: null },
    accessLevel: { type: String, enum: CIRCLE_ACCESS_LEVELS, required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    // Null until the invite is accepted; access checks only count accepted members.
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "care_circle_members" },
);

// Also serves every lookup by elderId alone.
careCircleMemberSchema.index({ elderId: 1, userId: 1 }, { unique: true });

export type CareCircleMember = InferSchemaType<typeof careCircleMemberSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export type NewCareCircleMember = Omit<
  InferSchemaType<typeof careCircleMemberSchema>,
  "createdAt" | "updatedAt"
>;

export const CareCircleMemberModel = model("CareCircleMember", careCircleMemberSchema);

// CarePlan → collection `care_plans`
// A medical record: each change writes version N+1 and nothing is overwritten.
const carePlanSchema = new Schema(
  {
    elderId: { type: Schema.Types.ObjectId, ref: "Elder", required: true },
    version: { type: Number, required: true, min: 1 },
    conditions: [String],
    medications: [
      {
        name: { type: String, required: true, trim: true },
        dosage: String,
        schedule: String,
        prescribedBy: String,
      },
    ],
    allergies: [String],
    mobility: { type: String, enum: MOBILITY_LEVELS },
    dietary: [String],
    careNotes: String,
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "care_plans" },
);

// Also serves "the latest version for this elder".
carePlanSchema.index({ elderId: 1, version: 1 }, { unique: true });

export type CarePlan = InferSchemaType<typeof carePlanSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const CarePlanModel = model("CarePlan", carePlanSchema);

// EmergencyContact → collection `emergency_contacts`

const emergencyContactSchema = new Schema(
  {
    elderId: { type: Schema.Types.ObjectId, ref: "Elder", required: true },
    name: { type: String, required: true, trim: true },
    // E.164, e.g. +254712345678.
    phone: { type: String, required: true },
    relationship: { type: String, trim: true },
    // 1 = call first.
    priority: { type: Number, required: true, min: 1 },
  },
  { timestamps: true, collection: "emergency_contacts" },
);

emergencyContactSchema.index({ elderId: 1, priority: 1 });

export type EmergencyContact = InferSchemaType<typeof emergencyContactSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const EmergencyContactModel = model("EmergencyContact", emergencyContactSchema);
