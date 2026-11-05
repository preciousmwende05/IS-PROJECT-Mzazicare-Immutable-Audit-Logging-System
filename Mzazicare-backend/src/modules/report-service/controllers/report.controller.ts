/**
 * U-CS 74 — Care Visit Reporting & Feedback System
 * Owner(s): Marsa Fatuma Omar
 *
 * Controllers stay thin: read the request, call the service, shape the reply.
 * No database access, no business rules, and never res.status(4xx) — throw an
 * AppError and let error.middleware turn it into a response.
 */

import type { Request, Response } from "express";

import { asyncHandler } from "@/shared/utils/async.util";
import { created, ok, paginated } from "@/shared/utils/response.util";
import { reportService } from "@/modules/report-service/services/report.service";
import { serializeCareLog } from "@/modules/report-service/views/report.view";

export const reportController = {
  createCareLog: asyncHandler(async (req: Request, res: Response) => {
    const report = await reportService.createCareLog(req.params.visitId!, req.body, req.user!);
    // The audit entry is filed under the elder ("who accessed my data").
    res.locals.elderId = String(report.elderId);
    return created(res, serializeCareLog(report));
  }),

  getCareLog: asyncHandler(async (req: Request, res: Response) => {
    const report = await reportService.getCareLog(req.params.visitId!, req.user!);
    if (report) res.locals.elderId = String(report.elderId);
    return ok(res, report ? serializeCareLog(report) : null);
  }),

  listForElder: asyncHandler(async (req: Request, res: Response) => {
    const page = await reportService.listForElder(
      req.params.elderId!,
      req.query as unknown as { page: number; limit: number },
      req.user!,
    );
    return paginated(res, { ...page, items: page.items.map(serializeCareLog) });
  }),
};
