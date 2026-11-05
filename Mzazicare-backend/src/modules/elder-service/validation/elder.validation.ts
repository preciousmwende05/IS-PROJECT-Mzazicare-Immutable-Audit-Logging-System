/**
 * U-CS 68 — Digital Elder Profile & Care Data System
 * Owner(s): Ian Omwenga, Mepani Bhavin Ramesh
 */

import { z } from "zod";

import {
  CIRCLE_ACCESS_LEVELS,
  ELDER_GENDERS,
  ELDER_STATUSES,
  MOBILITY_LEVELS,
} from "@/modules/elder-service/models/elder.model";

const objectId = z
  .string()
  .regex(
    /^[a-f\d]{24}$/i,
    "Invalid id",
  );

const name = z
  .string()
  .trim()
  .min(1)
  .max(80);

const text = z
  .string()
  .trim()
  .max(120);

// ---------------------------------------------------------------------------
// Elder profile
// ---------------------------------------------------------------------------

// String-only to prevent null, booleans, or numbers from being coerced into
// dates.
const dateOfBirth = z
  .string()
  .pipe(
    z.coerce
      .date()
      .refine(
        (date) =>
          date.getTime() < Date.now(),
        "dateOfBirth must be in the past",
      ),
  );

/**
 * Coordinates are supplied as named latitude/longitude values.
 *
 * The service converts them into GeoJSON:
 *
 * [longitude, latitude]
 */
const location = z
  .object({
    latitude: z
      .number()
      .min(-90)
      .max(90),

    longitude: z
      .number()
      .min(-180)
      .max(180),
  })
  .refine(
    ({ latitude, longitude }) =>
      latitude >= -5 &&
      latitude <= 5.5 &&
      longitude >= 33.5 &&
      longitude <= 42.5,
    "homeLocation must be in Kenya (are latitude and longitude swapped?)",
  );

const elderFields = {
  firstName: name,

  lastName: name,

  dateOfBirth,

  gender: z.enum(
    ELDER_GENDERS,
  ),

  homeLocation: location,

  address: z.object({
    estate: text.optional(),
    street: text.optional(),
    landmark: text.optional(),
    county: text.min(1),
  }),
};

// ---------------------------------------------------------------------------
// Care plan validation
// ---------------------------------------------------------------------------

const medicationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(120),

  dosage: z
    .string()
    .trim()
    .max(120)
    .optional(),

  schedule: z
    .string()
    .trim()
    .max(200)
    .optional(),

  prescribedBy: z
    .string()
    .trim()
    .max(120)
    .optional(),
});

const carePlanFields = {
  conditions: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(120),
    )
    .max(100),

  medications: z
    .array(medicationSchema)
    .max(100),

  allergies: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(120),
    )
    .max(100),

  mobility: z.enum(
    MOBILITY_LEVELS,
  ),

  dietary: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(120),
    )
    .max(100),

  careNotes: z
    .string()
    .trim()
    .max(5000),
};

const carePlanUpdateBody = z
  .object(carePlanFields)
  .partial()
  .refine(
    (body) =>
      Object.keys(body).length > 0,
    "Send at least one care-plan field to update",
  );

// ---------------------------------------------------------------------------
// Emergency contacts
// ---------------------------------------------------------------------------

const emergencyContactBody = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(120),

  /**
   * E.164:
   *
   * +254712345678
   * +14155552671
   *
   * No spaces, brackets or hyphens.
   */
  phone: z
    .string()
    .regex(
      /^\+[1-9]\d{7,14}$/,
      "Phone must be in E.164 format",
    ),

  relationship: z
    .string()
    .trim()
    .max(80)
    .optional(),

  priority: z
    .number()
    .int()
    .min(1)
    .max(100),
});

// ---------------------------------------------------------------------------
// Care-circle validation
// ---------------------------------------------------------------------------

const careCircleInviteBody = z.object({
  userId: objectId,

  relationship: z
    .string()
    .trim()
    .max(80)
    .optional(),

  accessLevel: z.enum([
    "editor",
    "viewer",
  ]),
});

const careCircleUpdateBody = z.object({
  accessLevel: z.enum([
    "editor",
    "viewer",
  ]),
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

const paginationQuery = z.object({
  page: z
    .coerce
    .number()
    .int()
    .min(1)
    .default(1),

  limit: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20),
});

/**
 * Request-shape validation only.
 *
 * Authorization and business rules belong in the service layer.
 */
export const elderValidation = {
  // -------------------------------------------------------------------------
  // Elder profile
  // -------------------------------------------------------------------------

  // GET / — `q` searches name, estate or county.
  list: z.object({
    query: paginationQuery.extend({
      q: z.string().trim().min(1).max(80).optional(),
    }),
  }),

  byId: z.object({
    params: z.object({
      id: objectId,
    }),
  }),

  create: z.object({
    body: z.object(elderFields),
  }),

  update: z.object({
    params: z.object({
      id: objectId,
    }),

    body: z
      .object(elderFields)
      .partial()
      .extend({
        status: z
          .enum(ELDER_STATUSES)
          .optional(),
      })
      .refine(
        (body) =>
          Object.keys(body).length > 0,
        "Send at least one field to update",
      ),
  }),

  // -------------------------------------------------------------------------
  // Care plans
  // -------------------------------------------------------------------------

  updateCarePlan: z.object({
    params: z.object({
      id: objectId,
    }),

    body: carePlanUpdateBody,
  }),

  carePlanHistory: z.object({
    params: z.object({
      id: objectId,
    }),

    query: paginationQuery,
  }),

  // -------------------------------------------------------------------------
  // Emergency contacts
  // -------------------------------------------------------------------------

  listEmergencyContacts: z.object({
    params: z.object({
      id: objectId,
    }),
  }),

  addEmergencyContact: z.object({
    params: z.object({
      id: objectId,
    }),

    body: emergencyContactBody,
  }),

  // -------------------------------------------------------------------------
  // Care circle
  // -------------------------------------------------------------------------

  listCareCircle: z.object({
    params: z.object({
      id: objectId,
    }),
  }),

  inviteCareCircleMember: z.object({
    params: z.object({
      id: objectId,
    }),

    body: careCircleInviteBody,
  }),

  updateCareCircleMember: z.object({
    params: z.object({
      id: objectId,
      userId: objectId,
    }),

    body: careCircleUpdateBody,
  }),

  removeCareCircleMember: z.object({
    params: z.object({
      id: objectId,
      userId: objectId,
    }),
  }),
};

// ---------------------------------------------------------------------------
// Inferred request types
// ---------------------------------------------------------------------------

export type CreateElderInput =
  z.infer<
    typeof elderValidation.create
  >["body"];

export type UpdateElderInput =
  z.infer<
    typeof elderValidation.update
  >["body"];

export type UpdateCarePlanInput =
  z.infer<
    typeof elderValidation.updateCarePlan
  >["body"];

export type AddEmergencyContactInput =
  z.infer<
    typeof elderValidation.addEmergencyContact
  >["body"];

export type InviteCareCircleMemberInput =
  z.infer<
    typeof elderValidation.inviteCareCircleMember
  >["body"];

export type UpdateCareCircleMemberInput =
  z.infer<
    typeof elderValidation.updateCareCircleMember
  >["body"];

export type CarePlanHistoryQuery =
  z.infer<
    typeof elderValidation.carePlanHistory
  >["query"];
  