/**
 * U-CS 70 — Care Services Discovery & Catalog System
 * Owner(s): Leonard Kipkoech, Ilhan Hamud
 */

import { Schema, model, type InferSchemaType, type HydratedDocument, type Types } from "mongoose";

export const SERVICE_STATUSES = ["draft", "published", "archived"] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const PRICING_UNITS = ["per_hour", "per_visit", "per_day"] as const;
export type PricingUnit = (typeof PRICING_UNITS)[number];

// ---------------------------------------------------------------------------
// ServiceCategory → collection `service_categories`
// ---------------------------------------------------------------------------
const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: "" },
    iconKey: { type: String, default: null },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "service_categories" },
);

categorySchema.index({ active: 1, sortOrder: 1 });

export type ServiceCategory = InferSchemaType<typeof categorySchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export type NewServiceCategory = Omit<InferSchemaType<typeof categorySchema>, "createdAt" | "updatedAt">;

export const ServiceCategoryModel = model("ServiceCategory", categorySchema);

// ---------------------------------------------------------------------------
// CareService → collection `care_services`
// ---------------------------------------------------------------------------
const catalogSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // Immutable once published: families bookmark the URL.
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "ServiceCategory", required: true },
    description: { type: String, default: "" },
    // Integer cents. "KES 800.50" is 80050. Never a float.
    basePriceCents: {
      type: Number,
      required: true,
      validate: { validator: Number.isInteger, message: "basePriceCents must be an integer" },
      min: 1,
    },
    pricingUnit: { type: String, enum: PRICING_UNITS, required: true },
    minimumDurationMinutes: { type: Number, required: true, min: 15 },
    // Matched against Caregiver.skills by booking-service.
    requiredSkills: { type: [String], default: [] },
    status: { type: String, enum: SERVICE_STATUSES, default: "draft", required: true },
    sortOrder: { type: Number, default: 0 },
    publishedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "care_services" },
);

catalogSchema.index({ status: 1, categoryId: 1, sortOrder: 1, name: 1 });
catalogSchema.index({ status: 1, basePriceCents: 1 });
catalogSchema.index({ name: "text", description: "text" });

export type CareService = InferSchemaType<typeof catalogSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export type NewCareService = InferSchemaType<typeof catalogSchema>;
export type CareServiceDocument = HydratedDocument<CareService>;

export const CareServiceModel = model("CareService", catalogSchema);

// ---------------------------------------------------------------------------
// PriceHistory → collection `service_price_history`
// One row per price change, append-only. Proves what the price was on a day.
// ---------------------------------------------------------------------------
const priceHistorySchema = new Schema(
  {
    serviceId: { type: Schema.Types.ObjectId, ref: "CareService", required: true },
    oldPriceCents: { type: Number, required: true },
    newPriceCents: { type: Number, required: true },
    changedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    effectiveFrom: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "service_price_history" },
);

priceHistorySchema.index({ serviceId: 1, effectiveFrom: -1 });

export type PriceHistory = InferSchemaType<typeof priceHistorySchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
};
export type NewPriceHistory = Omit<InferSchemaType<typeof priceHistorySchema>, "createdAt">;

export const PriceHistoryModel = model("ServicePriceHistory", priceHistorySchema);
