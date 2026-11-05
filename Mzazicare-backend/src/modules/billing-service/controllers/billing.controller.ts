/**
 * U-CS 75 — Care Services Payment & Billing System
 * Owner(s): Mukabwa Gloria Joy, Getenga Jarvis Mokaya
 */

/**
 * Controllers stay thin: read the request, call the service, shape the reply.
 * No database access, no business rules, and never res.status(4xx) — throw an
 * AppError and let error.middleware turn it into a response.
 *
 * import type { Request, Response } from "express";
 * import { asyncHandler } from "@/shared/utils/async.util";
 * import { created, paginated } from "@/shared/utils/response.util";
 * import { billingService } from "@/modules/billing-service/services/billing.service";
 * import { serializeInvoice } from "@/modules/billing-service/views/billing.view";
 */
export const billingController = {
  // list: asyncHandler(async (req: Request, res: Response) => {
  //   const page = await billingService.list(req.query);
  //   return paginated(res, { ...page, items: page.items.map(serializeInvoice) });
  // }),
  //
  // create: asyncHandler(async (req: Request, res: Response) => {
  //   const invoice = await billingService.create(req.body, req.user!.id);
  //   return created(res, serializeInvoice(invoice));
  // }),
};
