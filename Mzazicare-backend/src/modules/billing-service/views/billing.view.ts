/**
 * U-CS 75 — Care Services Payment & Billing System
 * Owner(s): Mukabwa Gloria Joy, Getenga Jarvis Mokaya
 */

import type { Invoice } from "@/modules/billing-service/models/billing.model";

/**
 * The shape the API returns. Views exist so that a document can never leak a
 * field by accident — add a field here deliberately or the client never sees it.
 */
export type InvoiceView = {
  id: string;
  createdAt: string;
};

export const serializeInvoice = (invoice: Invoice): InvoiceView => ({
  id: String(invoice._id),
  createdAt: invoice.createdAt.toISOString(),
});
