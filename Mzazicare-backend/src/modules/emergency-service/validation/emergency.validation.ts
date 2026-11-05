/**
 * U-CS 72 — Priority Emergency Handling & Escalation System
 * Owner(s): Wyclef Wasike Tavasi
 */

import { z } from "zod";

import {
  EMERGENCY_SEVERITIES,
  EMERGENCY_STATUSES,
  EMERGENCY_TYPES,
  ESCALATION_TARGET_TYPES,
  MAX_ESCALATION_LEVEL,
} from "@/modules/emergency-service/models/emergency.model";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

/** Clients send named fields; the service converts to GeoJSON [lng, lat]. */
const location = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

const idParams = z.object({ id: objectId });

const policyLevel = z.object({
  level: z.number().int().min(0).max(MAX_ESCALATION_LEVEL),
  targets: z.array(z.enum(ESCALATION_TARGET_TYPES)).min(1),
  afterSeconds: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60),
});

/**
 * Request-shape validation only: "is this well-formed?".
 * "May this user raise an alert for this elder?" is a service question.
 */
export const emergencyValidation = {
  /** POST / — family, caregiver or elder reporting an emergency. */
  raise: z.object({
    body: z.object({
      elderId: objectId,
      type: z.enum(EMERGENCY_TYPES),
      // Optional so a stressed reporter is never blocked on it. Unknown is treated as high.
      severity: z.enum(EMERGENCY_SEVERITIES).default("high"),
      description: z.string().trim().max(1000).optional(),
      location: location.optional(),
      activeBookingId: objectId.optional(),
    }),
  }),

  /** POST /panic — deliberately minimal. Under stress, the fewer required fields the better. */
  panic: z.object({
    body: z.object({
      elderId: objectId,
      location: location.optional(),
    }),
  }),

  /** GET / — the coordinators' live queue. With no status filter, every open emergency. */
  list: z.object({
    query: z.object({
      status: z.enum(EMERGENCY_STATUSES).optional(),
      severity: z.enum(EMERGENCY_SEVERITIES).optional(),
      ...pagination,
    }),
  }),

  byId: z.object({ params: idParams }),

  resolve: z.object({
    params: idParams,
    body: z.object({
      resolutionNote: z
        .string({ required_error: "A resolution note is required" })
        .trim()
        .min(3, "A resolution note is required"),
    }),
  }),

  falseAlarm: z.object({
    params: idParams,
    body: z.object({
      note: z.string().trim().max(1000).optional(),
    }),
  }),

  /** POST /:id/escalate — a coordinator skipping the timer. */
  escalate: z.object({
    params: idParams,
    body: z.object({
      reason: z.string().trim().max(500).optional(),
    }),
  }),

  history: z.object({
    params: z.object({ elderId: objectId }),
    query: z.object({ ...pagination }),
  }),

  /** PUT /policies — replace the ladder for one severity. */
  updatePolicy: z.object({
    body: z
      .object({
        severity: z.enum(EMERGENCY_SEVERITIES),
        levels: z
          .array(policyLevel)
          .min(1)
          .max(MAX_ESCALATION_LEVEL + 1),
      })
      .superRefine(({ levels }, ctx) => {
        levels.forEach((entry, index) => {
          if (entry.level !== index) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["levels", index, "level"],
              message: "Levels must be listed in order, starting at 0",
            });
          }
          const previous = levels[index - 1];
          if (index === 0 && entry.afterSeconds !== 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["levels", 0, "afterSeconds"],
              message: "Level 0 fires immediately, so afterSeconds must be 0",
            });
          }
          if (previous && entry.afterSeconds <= previous.afterSeconds) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["levels", index, "afterSeconds"],
              message: "Each level must fire later than the one before it",
            });
          }
          if (new Set(entry.targets).size !== entry.targets.length) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["levels", index, "targets"],
              message: "A target is listed twice",
            });
          }
        });
      }),
  }),
};

export type RaiseEmergencyInput = z.infer<typeof emergencyValidation.raise>["body"];
export type PanicInput = z.infer<typeof emergencyValidation.panic>["body"];
export type ListEmergenciesQuery = z.infer<typeof emergencyValidation.list>["query"];
export type ResolveEmergencyInput = z.infer<typeof emergencyValidation.resolve>["body"];
export type FalseAlarmInput = z.infer<typeof emergencyValidation.falseAlarm>["body"];
export type EscalateEmergencyInput = z.infer<typeof emergencyValidation.escalate>["body"];
export type UpdatePolicyInput = z.infer<typeof emergencyValidation.updatePolicy>["body"];
