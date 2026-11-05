/**
 * U-CS 70 — Care Services Discovery & Catalog System
 * Owner(s): Leonard Kipkoech, Ilhan Hamud
 *
 * Mounted at /v1/services.
 *
 * Middleware order is ALWAYS:
 *   authMiddleware -> requireRole/requirePermission -> validate -> audit -> controller
 *
 * Route order matters: the fixed "/categories" paths are declared before the
 * "/:slug" catch-all so "categories" is never read as a service slug.
 */

import { Router } from "express";

import { audit } from "@/shared/middleware/audit.middleware";
import { authMiddleware, optionalAuthMiddleware } from "@/shared/middleware/auth.middleware";
import { requireRole } from "@/shared/middleware/role.middleware";
import { validate } from "@/shared/middleware/validate.middleware";
import { catalogController } from "@/modules/catalog-service/controllers/catalog.controller";
import { catalogValidation } from "@/modules/catalog-service/validation/catalog.validation";

export const catalogRoutes = Router();

const admin = [authMiddleware, requireRole("admin")];

// ---------------- categories ----------------

catalogRoutes.get("/categories", optionalAuthMiddleware, catalogController.listCategories);

catalogRoutes.get(
  "/categories/:slug",
  optionalAuthMiddleware,
  validate(catalogValidation.bySlug),
  catalogController.getCategory,
);

catalogRoutes.post(
  "/categories",
  ...admin,
  validate(catalogValidation.createCategory),
  audit("catalog.category.created", (req) => ({ categoryId: req.res?.locals.categoryId })),
  catalogController.createCategory,
);

catalogRoutes.patch(
  "/categories/:id",
  ...admin,
  validate(catalogValidation.updateCategory),
  audit("catalog.category.updated", (req) => ({ categoryId: req.params.id })),
  catalogController.updateCategory,
);

// ---------------- services ----------------

catalogRoutes.get(
  "/",
  optionalAuthMiddleware,
  validate(catalogValidation.list),
  catalogController.list,
);

catalogRoutes.post(
  "/",
  ...admin,
  validate(catalogValidation.create),
  audit("catalog.service.created", (req) => ({ serviceId: req.res?.locals.serviceId })),
  catalogController.create,
);

catalogRoutes.get(
  "/:id/price-history",
  ...admin,
  validate(catalogValidation.byId),
  catalogController.priceHistory,
);

catalogRoutes.patch(
  "/:id",
  ...admin,
  validate(catalogValidation.update),
  audit("catalog.service.updated", (req) => ({
    serviceId: req.params.id,
    fields: Object.keys(req.body ?? {}),
  })),
  catalogController.update,
);

catalogRoutes.post(
  "/:id/publish",
  ...admin,
  validate(catalogValidation.byId),
  audit("catalog.service.published", (req) => ({ serviceId: req.params.id })),
  catalogController.publish,
);

catalogRoutes.post(
  "/:id/unpublish",
  ...admin,
  validate(catalogValidation.byId),
  audit("catalog.service.unpublished", (req) => ({ serviceId: req.params.id })),
  catalogController.unpublish,
);

catalogRoutes.post(
  "/:id/archive",
  ...admin,
  validate(catalogValidation.byId),
  audit("catalog.service.archived", (req) => ({ serviceId: req.params.id })),
  catalogController.archive,
);

// Last: the catch-all slug lookup.
catalogRoutes.get(
  "/:slug",
  optionalAuthMiddleware,
  validate(catalogValidation.bySlug),
  catalogController.getBySlug,
);
