import { Schema, model, type InferSchemaType, type Types } from "mongoose";

export const CAREGIVER_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "more_info",
  "approved",
  "rejected",
  "suspended",
  "expired",
] as const;
export type CaregiverStatus = (typeof CAREGIVER_STATUSES)[number];

export const KYC_DOC_TYPES = ["national_id", "certificate", "good_conduct", "reference"] as const;
export type KycDocType = (typeof KYC_DOC_TYPES)[number];

/** Without these two an application cannot be submitted or approved. */
export const REQUIRED_KYC_DOC_TYPES: readonly KycDocType[] = ["national_id", "good_conduct"];

/** Uploaded straight to RustFS via a presigned URL, then checked against these before a record is created. */
export const KYC_ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type KycMimeType = (typeof KYC_ALLOWED_MIME_TYPES)[number];
export const KYC_MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * An uploaded file must be registered within this window, and the orphan sweep only deletes
 * unregistered files older than KYC_ORPHAN_GRACE_MS. Keeping the grace far longer than the
 * window means the sweep can never delete a file that is still allowed to be registered.
 */
export const KYC_REGISTER_WINDOW_MS = 60 * 60 * 1000;
export const KYC_ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

export const KYC_DOC_STATUSES = ["pending", "verified", "rejected"] as const;
export type KycDocStatus = (typeof KYC_DOC_STATUSES)[number];

export const REAPPLY_COOLDOWN_DAYS = 30;

/* ------------------------------------------------------------------ */
/* Caregiver                                                           */
/* ------------------------------------------------------------------ */

const caregiverSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    bio: { type: String, required: true, trim: true, maxlength: 1000 },
    skills: { type: [String], default: [], index: true },
    yearsExperience: { type: Number, required: true, min: 0, max: 60 },
    serviceAreas: { type: [String], default: [], index: true },
    baseLocation: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },
    hourlyRateCents: { type: Number, required: true, min: 0 }, // integer cents
    status: { type: String, enum: [...CAREGIVER_STATUSES], default: "draft" },

    reviewerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    suspendedReason: { type: String, default: null },
    infoRequest: { type: String, default: null },

    // Derived. Never written by hand: maintained from feedback.submitted / visit.missed.
    ratingAverage: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
    noShowCount: { type: Number, default: 0, min: 0 },
    flaggedForReview: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "caregivers" },
);

caregiverSchema.index({ status: 1 });
caregiverSchema.index({ baseLocation: "2dsphere" });

type CaregiverBase = InferSchemaType<typeof caregiverSchema>;
export type Caregiver = Omit<CaregiverBase, "status"> & {
  _id: Types.ObjectId;
  status: CaregiverStatus;
  createdAt: Date;
  updatedAt: Date;
};

export const CaregiverModel = model("Caregiver", caregiverSchema);

/* ------------------------------------------------------------------ */
/* KycDocument                                                         */
/* ------------------------------------------------------------------ */

const kycDocumentSchema = new Schema(
  {
    caregiverId: { type: Schema.Types.ObjectId, ref: "Caregiver", required: true, index: true },
    type: { type: String, enum: [...KYC_DOC_TYPES], required: true },
    fileKey: { type: String, required: true }, // storage KEY. Never a URL.
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    status: { type: String, enum: [...KYC_DOC_STATUSES], default: "pending" },
    issuedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: null },
  },
  { timestamps: true, collection: "kyc_documents" },
);

kycDocumentSchema.index({ caregiverId: 1, type: 1 });
kycDocumentSchema.index({ status: 1, expiresAt: 1 });

type KycDocumentBase = InferSchemaType<typeof kycDocumentSchema>;
export type KycDocument = Omit<KycDocumentBase, "type" | "status"> & {
  _id: Types.ObjectId;
  type: KycDocType;
  status: KycDocStatus;
  createdAt: Date;
  updatedAt: Date;
};

export const KycDocumentModel = model("KycDocument", kycDocumentSchema);

/* ------------------------------------------------------------------ */
/* Availability                                                        */
/* ------------------------------------------------------------------ */

const availabilitySchema = new Schema(
  {
    caregiverId: { type: Schema.Types.ObjectId, ref: "Caregiver", required: true },
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 }, // 0 = Sunday
    startMinute: { type: Number, required: true, min: 0, max: 1439 }, // minutes from midnight (EAT)
    endMinute: { type: Number, required: true, min: 1, max: 1440 },
  },
  { timestamps: true, collection: "caregiver_availability" },
);

availabilitySchema.index({ caregiverId: 1, dayOfWeek: 1 });
availabilitySchema.index({ dayOfWeek: 1, startMinute: 1, endMinute: 1 });

export type AvailabilitySlot = InferSchemaType<typeof availabilitySchema> & { _id: Types.ObjectId };
export const AvailabilityModel = model("CaregiverAvailability", availabilitySchema);

/* ------------------------------------------------------------------ */
/* ProcessedEvent: makes event handlers idempotent                     */
/* ------------------------------------------------------------------ */

const processedEventSchema = new Schema(
  {
    _id: { type: String },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 }, // TTL: 30 days
  },
  { collection: "caregiver_processed_events", versionKey: false },
);

export const ProcessedEventModel = model("CaregiverProcessedEvent", processedEventSchema);

/* ------------------------------------------------------------------ */
/* CaregiverVisit: which caregiver did a visit                         */
/* ------------------------------------------------------------------ */

// feedback.submitted carries only a visitId. visit.checked_in carries both ids, so the
// consumer records the pair here and looks it up when the feedback arrives.
const caregiverVisitSchema = new Schema(
  {
    _id: { type: String }, // visitId
    caregiverId: { type: Schema.Types.ObjectId, ref: "Caregiver", required: true },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 90 }, // TTL: 90 days
  },
  { collection: "caregiver_visits", versionKey: false },
);

export const CaregiverVisitModel = model("CaregiverVisit", caregiverVisitSchema);