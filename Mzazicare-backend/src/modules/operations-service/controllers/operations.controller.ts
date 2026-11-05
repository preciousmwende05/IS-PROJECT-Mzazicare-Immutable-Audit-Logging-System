/**
 * U-CS 77 — Care Operations Monitoring & Control System
 * Owner(s): Samuel Kahiga, Wachira Peter Githinji
 */

/**
 * Controllers stay thin: read the request, call the service, shape the reply.
 * No database access, no business rules, and never res.status(4xx) — throw an
 * AppError and let error.middleware turn it into a response.
 *
 * import type { Request, Response } from "express";
 * import { asyncHandler } from "@/shared/utils/async.util";
 * import { created, paginated } from "@/shared/utils/response.util";
 * import { operationsService } from "@/modules/operations-service/services/operations.service";
 * import { serializeOperationsSnapshot } from "@/modules/operations-service/views/operations.view";
 */
export const operationsController = {
  // list: asyncHandler(async (req: Request, res: Response) => {
  //   const page = await operationsService.list(req.query);
  //   return paginated(res, { ...page, items: page.items.map(serializeOperationsSnapshot) });
  // }),
  //
  // create: asyncHandler(async (req: Request, res: Response) => {
  //   const operationsSnapshot = await operationsService.create(req.body, req.user!.id);
  //   return created(res, serializeOperationsSnapshot(operationsSnapshot));
  // }),
};
