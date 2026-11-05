/**
 * U-CS 74 — Care Visit Reporting & Feedback System
 * Owner(s): Marsa Fatuma Omar
 */

import { z } from "zod";

import { MOODS } from "@/modules/report-service/models/report.model";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

/**
 * Request-shape validation only — "is this well-formed?".
 * "Is this caregiver free on Tuesday?" is a service question, not this.
 */
export const reportValidation = {
  byVisit: z.object({
    params: z.object({ visitId: objectId }),
  }),

  byElder: z.object({
    params: z.object({ elderId: objectId }),
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  }),

  // POST /visits/:visitId/care-log — notes required; everything else only if measured.
  createCareLog: z.object({
    params: z.object({ visitId: objectId }),
    body: z
      .object({
        notes: z.string().trim().min(3, "Write a short note about the visit").max(2000),
        bloodPressureSystolic: z.number().int().min(50).max(260).optional(),
        bloodPressureDiastolic: z.number().int().min(30).max(160).optional(),
        mood: z.enum(MOODS).optional(),
        meals: z.string().trim().max(500).optional(),
      })
      .refine(
        (b) => (b.bloodPressureSystolic === undefined) === (b.bloodPressureDiastolic === undefined),
        { message: "Give both blood pressure numbers, or neither", path: ["bloodPressureDiastolic"] },
      )
      .refine(
        (b) => b.bloodPressureSystolic === undefined || b.bloodPressureSystolic > (b.bloodPressureDiastolic ?? 0),
        { message: "The first blood pressure number (systolic) must be the higher one", path: ["bloodPressureSystolic"] },
      ),
  }),
};

export type CreateCareLogInput = z.infer<typeof reportValidation.createCareLog>["body"];
