/**
 * U-CS 78 — Immutable Audit Logging & Compliance System
 * Owner(s): Precious Mwende Waweru, Anthony Atenya
 */

import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

/**
 * Request-shape validation only — "is this well-formed?".
 * "Is this caregiver free on Tuesday?" is a service question, not this.
 */
export const auditValidation = {
  list: z.object({
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  }),

  byId: z.object({
    params: z.object({ id: objectId }),
  }),

  // GET /:sequence — the route's param is a sequence number, not an ObjectId.
  bySequence: z.object({
    params: z.object({ sequence: z.coerce.number().int().min(1) }),
  }),

  // GET /anomalies — alerts for admins and auditors.
  anomalies: z.object({
    query: z.object({
      status: z.enum(["open", "resolved"]).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  }),

  // POST /anomalies/:id/resolve — what was found, in a sentence (kept on the alert).
  resolveAnomaly: z.object({
    params: z.object({ id: objectId }),
    body: z.object({ note: z.string().trim().min(5, "Say what you found").max(1000) }),
  }),
};
