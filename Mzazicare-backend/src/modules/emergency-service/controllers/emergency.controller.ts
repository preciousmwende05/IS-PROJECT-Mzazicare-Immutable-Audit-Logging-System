/**
 * U-CS 72 — Priority Emergency Handling & Escalation System
 * Owner(s): Wyclef Wasike Tavasi
 */

import type { Request, Response } from "express";

import { asyncHandler } from "@/shared/utils/async.util";
import { created, ok, paginated } from "@/shared/utils/response.util";
import {
  emergencyService,
  type RaiseResult,
} from "@/modules/emergency-service/services/emergency.service";
import {
  serializeEmergency,
  serializeEmergencyDetail,
  serializeEscalationPolicy,
} from "@/modules/emergency-service/views/emergency.view";

/**
 * Controllers stay thin: read the request, call the service, shape the reply.
 * No database access, no business rules, and never res.status(4xx).
 */

/** 201 for a new emergency; 200 with meta.collapsed when the press joined an open one. */
const replyToRaise = (res: Response, { emergency, collapsed }: RaiseResult) =>
  collapsed
    ? ok(res, serializeEmergency(emergency), { collapsed: true })
    : created(res, serializeEmergency(emergency));

export const emergencyController = {
  raise: asyncHandler(async (req: Request, res: Response) =>
    replyToRaise(res, await emergencyService.raise(req.body, req.user!)),
  ),

  panic: asyncHandler(async (req: Request, res: Response) =>
    replyToRaise(res, await emergencyService.panic(req.body, req.user!)),
  ),

  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await emergencyService.list(req.query as never);
    return paginated(res, { ...page, items: page.items.map(serializeEmergency) });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const { emergency, steps } = await emergencyService.getDetail(req.params.id!, req.user!);
    return ok(res, serializeEmergencyDetail(emergency, steps));
  }),

  acknowledge: asyncHandler(async (req: Request, res: Response) =>
    ok(res, serializeEmergency(await emergencyService.acknowledge(req.params.id!, req.user!))),
  ),

  respond: asyncHandler(async (req: Request, res: Response) =>
    ok(res, serializeEmergency(await emergencyService.respond(req.params.id!, req.user!))),
  ),

  resolve: asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      serializeEmergency(await emergencyService.resolve(req.params.id!, req.body, req.user!)),
    ),
  ),

  falseAlarm: asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      serializeEmergency(await emergencyService.falseAlarm(req.params.id!, req.body, req.user!)),
    ),
  ),

  history: asyncHandler(async (req: Request, res: Response) => {
    const page = await emergencyService.history(req.params.elderId!, req.query, req.user!);
    return paginated(res, { ...page, items: page.items.map(serializeEmergency) });
  }),
  escalate: asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      serializeEmergency(await emergencyService.escalate(req.params.id!, req.body, req.user!)),
    ),
  ),

  listPolicies: asyncHandler(async (_req: Request, res: Response) =>
    ok(res, (await emergencyService.listPolicies()).map(serializeEscalationPolicy)),
  ),

  updatePolicy: asyncHandler(async (req: Request, res: Response) =>
    ok(res, serializeEscalationPolicy(await emergencyService.updatePolicy(req.body, req.user!))),
  ),
};
