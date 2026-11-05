/**
 * Consent & Data Rights (Kenya Data Protection Act, 2019)
 * Owner(s): Precious Mwende Waweru, Anthony Atenya (with U-CS 78)
 */

import { Schema, model, type InferSchemaType, type Types } from "mongoose";

// ---------------------------------------------------------------------------
// ConsentRecord → collection `consent_records`
// Append-only: the latest record is the current answer; earlier ones are the
// history ("given 12 Sep, withdrawn 4 Nov"). Never edited, never deleted.
// ---------------------------------------------------------------------------

export const CONSENT_PURPOSES = ["careplan_sharing"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

const consentRecordSchema = new Schema(
  {
    elderId: { type: Schema.Types.ObjectId, ref: "Elder", required: true },
    // "Share my care plan with caregivers"
    purpose: { type: String, enum: CONSENT_PURPOSES, required: true },
    granted: { type: Boolean, required: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // "elder" when the elder recorded it themself, "guardian" for a family owner/editor.
    recordedAs: { type: String, enum: ["elder", "guardian"], required: true },
    note: { type: String, trim: true, maxlength: 500, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "consent_records" },
);

consentRecordSchema.index({ elderId: 1, purpose: 1, createdAt: -1 });

export type ConsentRecord = InferSchemaType<typeof consentRecordSchema> & { _id: Types.ObjectId; createdAt: Date };
export type NewConsentRecord = Omit<InferSchemaType<typeof consentRecordSchema>, "createdAt">;
export const ConsentRecordModel = model("ConsentRecord", consentRecordSchema);

// ---------------------------------------------------------------------------
// DataRequest → collection `data_requests`
//   export:   completed at once (the requester downloads a copy).
//   deletion: requested → reviewed → completed (erased) | refused, with a reason.
// ---------------------------------------------------------------------------

export const DATA_REQUEST_TYPES = ["export", "deletion"] as const;
export const DATA_REQUEST_STATUSES = ["requested", "reviewed", "completed", "refused"] as const;
export type DataRequestType = (typeof DATA_REQUEST_TYPES)[number];
export type DataRequestStatus = (typeof DATA_REQUEST_STATUSES)[number];

const dataRequestSchema = new Schema(
  {
    elderId: { type: Schema.Types.ObjectId, ref: "Elder", required: true },
    // A label for reviewers ("Mary Wambui (EL-644DA)"); replaced once erased.
    elderLabel: { type: String, required: true },
    type: { type: String, enum: DATA_REQUEST_TYPES, required: true },
    status: { type: String, enum: DATA_REQUEST_STATUSES, required: true },
    reason: { type: String, trim: true, maxlength: 1000, default: null },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },

    decision: { type: String, enum: ["approved", "refused", null], default: null },
    decisionReason: { type: String, trim: true, maxlength: 1000, default: null },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "data_requests" },
);

dataRequestSchema.index({ status: 1, createdAt: -1 });
dataRequestSchema.index({ elderId: 1, createdAt: -1 });

export type DataRequest = InferSchemaType<typeof dataRequestSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export type NewDataRequest = Omit<InferSchemaType<typeof dataRequestSchema>, "createdAt" | "updatedAt">;
export const DataRequestModel = model("DataRequest", dataRequestSchema);
