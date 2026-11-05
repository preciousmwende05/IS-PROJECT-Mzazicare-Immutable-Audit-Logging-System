/**
 * U-CS 73 — Geo-Verified Visit Tracking System
 * Owner(s): Alvin Kimani, Hezekiah Muiruri Munene
 */

/**
 * Controllers stay thin: read the request, call the service, shape the reply.
 * No database access, no business rules, and never res.status(4xx) — throw an
 * AppError and let error.middleware turn it into a response.
 */

import type { Request, Response } from "express";

import { asyncHandler } from "@/shared/utils/async.util";
import { ok, paginated } from "@/shared/utils/response.util";
import type { Paginated } from "@/shared/types";

import { visitService } from "@/modules/visit-service/services/visit.service";
import type { Visit } from "@/modules/visit-service/models/visit.model";
import type {
  FlaggedVisitsQuery,
  ListVisitsQuery,
} from "@/modules/visit-service/validation/visit.validation";
import { serializeVisitFor, serializeVisitTrack } from "@/modules/visit-service/views/visit.view";

/** Coordinators see flags and distances; everyone else the family view. */
const reply = (req: Request, res: Response, visit: Visit) =>
  ok(res, serializeVisitFor(visit, req.user!.role));

const replyPage = (req: Request, res: Response, page: Paginated<Visit>) =>
  paginated(res, {
    ...page,
    items: page.items.map((visit) => serializeVisitFor(visit, req.user!.role)),
  });

export const visitController = {
  // Reads

  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await visitService.list(req.query as unknown as ListVisitsQuery, req.user!);
    return replyPage(req, res, page);
  }),

  listActive: asyncHandler(async (req: Request, res: Response) => {
    const page = await visitService.listActive(req.query, req.user!);
    return replyPage(req, res, page);
  }),

  listFlagged: asyncHandler(async (req: Request, res: Response) => {
    const page = await visitService.listFlagged(
      req.query as unknown as FlaggedVisitsQuery,
      req.user!,
    );
    return replyPage(req, res, page);
  }),

  getOne: asyncHandler(async (req: Request, res: Response) => {
    const visit = await visitService.getById(req.params.id!, req.user!);
    return reply(req, res, visit);
  }),

  // Caregiver actions

  enRoute: asyncHandler(async (req: Request, res: Response) => {
    const visit = await visitService.markEnRoute(req.params.id!, req.user!);
    return reply(req, res, visit);
  }),

  checkIn: asyncHandler(async (req: Request, res: Response) => {
    const visit = await visitService.checkIn(req.params.id!, req.body, req.user!);
    return reply(req, res, visit);
  }),

  ping: asyncHandler(async (req: Request, res: Response) => {
    await visitService.ping(req.params.id!, req.body, req.user!);
    return ok(res, { received: true });
  }),

  checkOut: asyncHandler(async (req: Request, res: Response) => {
    const visit = await visitService.checkOut(req.params.id!, req.body, req.user!);
    return reply(req, res, visit);
  }),

  // Tracking and disputes

  track: asyncHandler(async (req: Request, res: Response) => {
    const tracked = await visitService.track(req.params.id!, req.user!);
    return ok(res, serializeVisitTrack(tracked));
  }),

  dispute: asyncHandler(async (req: Request, res: Response) => {
    const visit = await visitService.dispute(req.params.id!, req.body, req.user!);
    return reply(req, res, visit);
  }),

  resolveDispute: asyncHandler(async (req: Request, res: Response) => {
    const visit = await visitService.resolveDispute(req.params.id!, req.body, req.user!);
    return reply(req, res, visit);
  }),
};
