/**
 * U-CS 74 — Care Visit Reporting & Feedback System
 * Owner(s): Marsa Fatuma Omar
 *
 * The care log: what happened during a visit, in the caregiver's words, plus a
 * few simple measurements. One per visit, written by the assigned caregiver,
 * read by the elder's care circle. Immutable once submitted: it is a care record.
 */

import { Schema, model, type InferSchemaType, type HydratedDocument, type Types } from "mongoose";

export const MOODS = ["cheerful", "calm", "withdrawn", "agitated", "distressed"] as const;
export type Mood = (typeof MOODS)[number];

/**
 * What was measured, never a judgement. We store numbers; a human decides what
 * they mean. All optional: record only if measured.
 */
const vitalsSchema = new Schema(
  {
    bloodPressureSystolic: { type: Number, min: 50, max: 260 },
    bloodPressureDiastolic: { type: Number, min: 30, max: 160 },
  },
  { _id: false },
);

const reportSchema = new Schema(
  {
    visitId: { type: Schema.Types.ObjectId, ref: "Visit", required: true, unique: true },
    // Denormalised from the visit so the family's list can be queried directly.
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
    elderId: { type: Schema.Types.ObjectId, ref: "Elder", required: true },
    caregiverId: { type: Schema.Types.ObjectId, ref: "Caregiver", required: true },
    authorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },

    notes: { type: String, required: true, trim: true, maxlength: 2000 },
    vitals: { type: vitalsSchema, default: null },
    mood: { type: String, enum: MOODS, default: null },
    meals: { type: String, trim: true, maxlength: 500, default: null },

    submittedAt: { type: Date, required: true },
    // The first time someone in the family opens it.
    acknowledgedAt: { type: Date, default: null },
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, collection: "visit_reports" },
);

reportSchema.index({ elderId: 1, submittedAt: -1 });
reportSchema.index({ caregiverId: 1, submittedAt: -1 });

export type VisitReport = InferSchemaType<typeof reportSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export type NewVisitReport = Omit<InferSchemaType<typeof reportSchema>, "createdAt" | "updatedAt">;
export type VisitReportDocument = HydratedDocument<VisitReport>;

export const VisitReportModel = model("VisitReport", reportSchema);
