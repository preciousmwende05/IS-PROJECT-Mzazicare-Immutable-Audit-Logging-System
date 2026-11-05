/**
 * U-CS 75 — Care Services Payment & Billing System
 * Owner(s): Mukabwa Gloria Joy, Getenga Jarvis Mokaya
 */

import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

/**
 * Request-shape validation only — "is this well-formed?".
 * "Is this caregiver free on Tuesday?" is a service question, not this.
 */
export const billingValidation = {
  list: z.object({
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  }),

  byId: z.object({
    params: z.object({ id: objectId }),
  }),

  // TODO(billing): add the schemas for the endpoints you expose.
};
