/**
 * Consent & Data Rights — request-shape validation only.
 */

import { z } from "zod";

import { DATA_REQUEST_STATUSES, DATA_REQUEST_TYPES } from "@/modules/consent-service/models/consent.model";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const page = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const consentValidation = {
  byElder: z.object({ params: z.object({ elderId: objectId }) }),

  accessLog: z.object({
    params: z.object({ elderId: objectId }),
    query: z.object(page),
  }),

  // PUT /elders/:elderId/consent — "share my care plan with caregivers": yes or no.
  setConsent: z.object({
    params: z.object({ elderId: objectId }),
    body: z.object({
      granted: z.boolean(),
      note: z.string().trim().max(500).optional(),
    }),
  }),

  requestDeletion: z.object({
    params: z.object({ elderId: objectId }),
    body: z.object({
      reason: z.string().trim().min(10, "Please explain why, in a sentence or two").max(1000),
    }),
  }),

  listRequests: z.object({
    query: z.object({
      status: z.enum(DATA_REQUEST_STATUSES).optional(),
      type: z.enum(DATA_REQUEST_TYPES).optional(),
      ...page,
    }),
  }),

  byRequest: z.object({ params: z.object({ id: objectId }) }),

  // POST /data-requests/:id/decision — a reason is required either way; it is sent to the requester.
  decide: z.object({
    params: z.object({ id: objectId }),
    body: z.object({
      decision: z.enum(["approve", "refuse"]),
      reason: z.string().trim().min(10, "Explain the decision; the requester will read it").max(1000),
    }),
  }),
};

export type SetConsentInput = z.infer<typeof consentValidation.setConsent>["body"];
export type DecideInput = z.infer<typeof consentValidation.decide>["body"];
export type ListRequestsQuery = z.infer<typeof consentValidation.listRequests>["query"];
