/**
 * U-CS 75 — Care Services Payment & Billing System
 * Owner(s): Mukabwa Gloria Joy, Getenga Jarvis Mokaya
 */

import {
  InvoiceModel,
  type Invoice,
  type NewInvoice,
} from "@/modules/billing-service/models/billing.model";

/**
 * The only layer allowed to touch the database. Repositories answer data
 * questions ("find these rows"); they never decide anything.
 */
export const billingRepository = {
  findById: async (id: string): Promise<Invoice | null> =>
    InvoiceModel.findById(id).lean<Invoice>(),

  create: async (data: NewInvoice): Promise<Invoice> => {
    const doc = await InvoiceModel.create(data);
    return doc.toObject() as Invoice;
  },

  update: async (id: string, patch: Partial<NewInvoice>): Promise<Invoice | null> =>
    InvoiceModel.findByIdAndUpdate(id, patch, { new: true }).lean<Invoice>(),

  delete: async (id: string): Promise<void> => {
    await InvoiceModel.findByIdAndDelete(id);
  },

  // TODO(billing): add the queries U-CS 75 needs. Index every field you filter or sort by.
};
