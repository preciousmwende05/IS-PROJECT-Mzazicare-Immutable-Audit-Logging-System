/**
 * U-CS 70 — Care Services Discovery & Catalog System
 * Owner(s): Leonard Kipkoech, Ilhan Hamud
 */

import type { Request, Response } from "express";

import { asyncHandler } from "@/shared/utils/async.util";
import { created, ok, paginated } from "@/shared/utils/response.util";
import { catalogService } from "@/modules/catalog-service/services/catalog.service";
import type { ListServicesQuery } from "@/modules/catalog-service/validation/catalog.validation";
import {
  serializeCareServiceAdmin,
  serializeCategory,
  serializePriceHistory,
} from "@/modules/catalog-service/views/catalog.view";

/**
 * Controllers stay thin: read the request, call the service, shape the reply.
 * No database access, no business rules, and never res.status(4xx) — throw an
 * AppError and let error.middleware turn it into a response.
 */

const isAdmin = (req: Request): boolean => req.user?.role === "admin";

export const catalogController = {
  // ---------------- discovery ----------------

  list: asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as ListServicesQuery;
    if (isAdmin(req)) {
      const page = await catalogService.list(query, true);
      return paginated(res, { ...page, items: page.items.map(serializeCareServiceAdmin) });
    }
    return paginated(res, await catalogService.listPublic(query));
  }),

  getBySlug: asyncHandler(async (req: Request, res: Response) => {
    const slug = req.params.slug!;
    if (isAdmin(req)) {
      return ok(res, serializeCareServiceAdmin(await catalogService.getBySlug(slug, true)));
    }
    return ok(res, await catalogService.getPublicBySlug(slug));
  }),

  listCategories: asyncHandler(async (req: Request, res: Response) =>
    ok(res, await catalogService.listCategories(isAdmin(req))),
  ),

  getCategory: asyncHandler(async (req: Request, res: Response) =>
    ok(res, await catalogService.getCategoryBySlug(req.params.slug!, isAdmin(req))),
  ),

  // ---------------- administration ----------------

  create: asyncHandler(async (req: Request, res: Response) => {
    const service = await catalogService.create(req.body, req.user!.id);
    res.locals.serviceId = String(service._id);
    return created(res, serializeCareServiceAdmin(service));
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const service = await catalogService.update(req.params.id!, req.body, req.user!.id);
    return ok(res, serializeCareServiceAdmin(service));
  }),

  publish: asyncHandler(async (req: Request, res: Response) =>
    ok(res, serializeCareServiceAdmin(await catalogService.publish(req.params.id!))),
  ),

  unpublish: asyncHandler(async (req: Request, res: Response) =>
    ok(res, serializeCareServiceAdmin(await catalogService.unpublish(req.params.id!))),
  ),

  archive: asyncHandler(async (req: Request, res: Response) =>
    ok(res, serializeCareServiceAdmin(await catalogService.archive(req.params.id!))),
  ),

  priceHistory: asyncHandler(async (req: Request, res: Response) => {
    const rows = await catalogService.priceHistory(req.params.id!);
    return ok(res, rows.map(serializePriceHistory));
  }),

  createCategory: asyncHandler(async (req: Request, res: Response) => {
    const category = await catalogService.createCategory(req.body);
    res.locals.categoryId = String(category._id);
    return created(res, serializeCategory(category));
  }),

  updateCategory: asyncHandler(async (req: Request, res: Response) =>
    ok(res, serializeCategory(await catalogService.updateCategory(req.params.id!, req.body))),
  ),
};
