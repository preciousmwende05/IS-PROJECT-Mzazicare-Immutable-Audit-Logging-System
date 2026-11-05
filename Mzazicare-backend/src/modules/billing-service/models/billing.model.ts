/**
 * U-CS 75 — Care Services Payment & Billing System
 * Owner(s): Mukabwa Gloria Joy, Getenga Jarvis Mokaya
 */

import { Schema, model, type InferSchemaType, type HydratedDocument, type Types } from "mongoose";

const billingSchema = new Schema(
  {
    // TODO(billing): define the persisted fields for U-CS 75.
  },
  { timestamps: true, collection: "invoices" },
);

// Index what you filter and sort on.
// billingSchema.index({ createdAt: -1 });

export type Invoice = InferSchemaType<typeof billingSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export type NewInvoice = InferSchemaType<typeof billingSchema>;
export type InvoiceDocument = HydratedDocument<Invoice>;

export const InvoiceModel = model("Invoice", billingSchema);
