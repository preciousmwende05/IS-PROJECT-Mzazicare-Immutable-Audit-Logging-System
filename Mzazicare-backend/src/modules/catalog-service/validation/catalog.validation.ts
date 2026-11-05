/**
 * U-CS 70 — Care Services Discovery & Catalog System
 * Owner(s): Leonard Kipkoech, Ilhan Hamud
 */

import { z } from "zod";

import { PRICING_UNITS, SERVICE_STATUSES } from "@/modules/catalog-service/models/catalog.model";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase words joined by hyphens");

// Integer cents. A float is rejected loudly rather than rounded quietly.
const priceCents = z.number().int("Price must be integer cents, e.g. KES 800.50 is 80050").positive();
const skill = z.string().trim().toLowerCase().min(1).max(40);

const page = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

const serviceFields = {
  name: z.string().trim().min(2).max(120),
  slug: slug.optional(),
  categoryId: objectId,
  description: z.string().trim().max(2000).default(""),
  basePriceCents: priceCents,
  pricingUnit: z.enum(PRICING_UNITS),
  minimumDurationMinutes: z.number().int().min(15).max(24 * 60),
  requiredSkills: z.array(skill).max(20).default([]),
  sortOrder: z.number().int().default(0),
};

const categoryFields = {
  name: z.string().trim().min(2).max(80),
  slug: slug.optional(),
  description: z.string().trim().max(500).default(""),
  iconKey: z.string().trim().max(40).nullable().optional(),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
};

/**
 * Request-shape validation only — "is this well-formed?".
 * "Is this caregiver free on Tuesday?" is a service question, not this.
 */
export const catalogValidation = {
  /** GET / — public discovery. `status` is honoured for admins only (service decides). */
  list: z.object({
    query: z
      .object({
        category: slug.optional(),
        q: z.string().trim().min(1).max(100).optional(),
        minPrice: z.coerce.number().int().min(0).optional(),
        maxPrice: z.coerce.number().int().min(0).optional(),
        status: z.enum(SERVICE_STATUSES).optional(),
        ...page,
      })
      .refine(
        (q) => q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice,
        "minPrice must not exceed maxPrice",
      ),
  }),

  bySlug: z.object({
    params: z.object({ slug }),
  }),

  byId: z.object({
    params: z.object({ id: objectId }),
  }),

  create: z.object({
    body: z.object(serviceFields),
  }),

  update: z.object({
    params: z.object({ id: objectId }),
    body: z
      .object({
        name: serviceFields.name,
        slug,
        categoryId: objectId,
        description: z.string().trim().max(2000),
        basePriceCents: priceCents,
        pricingUnit: serviceFields.pricingUnit,
        minimumDurationMinutes: serviceFields.minimumDurationMinutes,
        requiredSkills: z.array(skill).max(20),
        sortOrder: z.number().int(),
      })
      .partial()
      .refine((b) => Object.keys(b).length > 0, "Send at least one field to update"),
  }),

  createCategory: z.object({
    body: z.object(categoryFields),
  }),

  updateCategory: z.object({
    params: z.object({ id: objectId }),
    body: z
      .object({
        name: categoryFields.name,
        slug,
        description: z.string().trim().max(500),
        iconKey: z.string().trim().max(40).nullable(),
        sortOrder: z.number().int(),
        active: z.boolean(),
      })
      .partial()
      .refine((b) => Object.keys(b).length > 0, "Send at least one field to update"),
  }),
};

export type ListServicesQuery = z.infer<typeof catalogValidation.list>["query"];
export type CreateServiceInput = z.infer<typeof catalogValidation.create>["body"];
export type UpdateServiceInput = z.infer<typeof catalogValidation.update>["body"];
export type CreateCategoryInput = z.infer<typeof catalogValidation.createCategory>["body"];
export type UpdateCategoryInput = z.infer<typeof catalogValidation.updateCategory>["body"];
