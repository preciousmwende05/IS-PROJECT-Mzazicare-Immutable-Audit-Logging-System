/**
 * Consent & Data Rights — thin HTTP layer.
 */

import type { Request, Response } from "express";

import { asyncHandler } from "@/shared/utils/async.util";
import { created, ok, paginated } from "@/shared/utils/response.util";
import { consentService } from "@/modules/consent-service/services/consent.service";
import type { ListRequestsQuery } from "@/modules/consent-service/validation/consent.validation";
import { requestUserIds, serializeDataRequest } from "@/modules/consent-service/views/consent.view";
import { authService } from "@/modules/auth-service/services/auth.service";

export const consentController = {
  getConsent: asyncHandler(async (req: Request, res: Response) =>
    ok(res, await consentService.getConsent(req.params.elderId!, req.user!)),
  ),

  setConsent: asyncHandler(async (req: Request, res: Response) =>
    ok(res, await consentService.setConsent(req.params.elderId!, req.body, req.user!)),
  ),

  accessLog: asyncHandler(async (req: Request, res: Response) => {
    const page = await consentService.accessLog(
      req.params.elderId!,
      req.query as unknown as { page: number; limit: number },
      req.user!,
    );
    return paginated(res, page);
  }),

  exportData: asyncHandler(async (req: Request, res: Response) =>
    ok(res, await consentService.exportData(req.params.elderId!, req.user!)),
  ),

  requestDeletion: asyncHandler(async (req: Request, res: Response) => {
    const request = await consentService.requestDeletion(req.params.elderId!, req.body.reason, req.user!);
    res.locals.requestId = request.id;
    return created(res, request);
  }),

  requestsForElder: asyncHandler(async (req: Request, res: Response) =>
    ok(res, await consentService.requestsForElder(req.params.elderId!, req.user!)),
  ),

  listRequests: asyncHandler(async (req: Request, res: Response) =>
    paginated(res, await consentService.listRequests(req.query as unknown as ListRequestsQuery)),
  ),

  getRequest: asyncHandler(async (req: Request, res: Response) =>
    ok(res, await consentService.getRequest(req.params.id!, req.user!)),
  ),

  review: asyncHandler(async (req: Request, res: Response) => {
    const request = await consentService.review(req.params.id!, req.user!);
    res.locals.elderId = String(request.elderId);
    const names = await authService.getDisplayNames(requestUserIds([request]));
    return ok(res, serializeDataRequest(request, names));
  }),

  decide: asyncHandler(async (req: Request, res: Response) => {
    const request = await consentService.decide(req.params.id!, req.body, req.user!);
    res.locals.elderId = String(request.elderId);
    const names = await authService.getDisplayNames(requestUserIds([request]));
    return ok(res, serializeDataRequest(request, names));
  }),
};
