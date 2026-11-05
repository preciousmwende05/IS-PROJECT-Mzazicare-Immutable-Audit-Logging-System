/**
 * U-CS 68 — Digital Elder Profile & Care Data System
 * Owner(s): Ian Omwenga, Mepani Bhavin Ramesh
 */

/**
 * Controllers stay thin: read the request, call the service, shape the reply.
 * No database access, no business rules, and never res.status(4xx) — throw an
 * AppError and let error.middleware turn it into a response.
 */

import type { Request, Response } from "express";

import { asyncHandler } from "@/shared/utils/async.util";
import {
  created,
  ok,
  paginated,
} from "@/shared/utils/response.util";

import {
  elderCareDataService,
  elderService,
} from "@/modules/elder-service/services/elder.service";

import {
  serializeCaregiverBrief,
  serializeElder,
  serializeCarePlan,
  serializeCareCircleMember,
  serializeEmergencyContact,
} from "@/modules/elder-service/views/elder.view";

export const elderController = {
  // Elder profile

  create: asyncHandler(async (req: Request, res: Response) => {
    const elder = await elderService.create(req.body, req.user!);

    // The audit subject in elder.routes reads this once the response finishes.
    res.locals.elderId = String(elder._id);

    return created(res, serializeElder(elder));
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await elderService.list(req.query, req.user!);

    return paginated(res, {
      ...page,
      items: page.items.map(serializeElder),
    });
  }),

  getOne: asyncHandler(async (req: Request, res: Response) => {
    const elder = await elderService.getForActor(
      req.params.id!,
      req.user!,
    );

    return ok(res, serializeElder(elder));
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const elder = await elderService.update(
      req.params.id!,
      req.body,
      req.user!,
    );

    return ok(res, serializeElder(elder));
  }),

  brief: asyncHandler(async (req: Request, res: Response) => {
    const { elder, carePlan, contacts } =
      await elderService.getCaregiverBrief(
        req.params.id!,
        req.user!,
      );

    return ok(
      res,
      serializeCaregiverBrief(
        elder,
        carePlan,
        contacts,
      ),
    );
  }),

  // Care plan
  

  getCarePlan: asyncHandler(async (req: Request, res: Response) => {
    const carePlan = await elderCareDataService.getCarePlan(
      req.params.id!,
      req.user!,
    );

    return ok(
      res,
      carePlan ? serializeCarePlan(carePlan) : null,
    );
  }),

  updateCarePlan: asyncHandler(async (req: Request, res: Response) => {
    const carePlan =
      await elderCareDataService.updateCarePlan(
        req.params.id!,
        req.body,
        req.user!,
      );

    res.locals.elderId = req.params.id;

    return created(
      res,
      serializeCarePlan(carePlan),
    );
  }),

  getCarePlanHistory: asyncHandler(
    async (req: Request, res: Response) => {
      const page =
        await elderCareDataService.getCarePlanHistory(
          req.params.id!,
          req.query as never,
          req.user!,
        );

      return paginated(res, {
        ...page,
        items: page.items.map(serializeCarePlan),
      });
    },
  ),

  // Emergency contacts

  listEmergencyContacts: asyncHandler(
    async (req: Request, res: Response) => {
      const contacts =
        await elderCareDataService.listEmergencyContacts(
          req.params.id!,
          req.user!,
        );

      return ok(
        res,
        contacts.map(serializeEmergencyContact),
      );
    },
  ),

  addEmergencyContact: asyncHandler(
    async (req: Request, res: Response) => {
      const contact =
        await elderCareDataService.addEmergencyContact(
          req.params.id!,
          req.body,
          req.user!,
        );

      res.locals.elderId = req.params.id;

      return created(
        res,
        serializeEmergencyContact(contact),
      );
    },
  ),

  // Care circle

  listCareCircle: asyncHandler(
    async (req: Request, res: Response) => {
      const members =
        await elderCareDataService.listCareCircle(
          req.params.id!,
          req.user!,
        );

      return ok(
        res,
        members.map(serializeCareCircleMember),
      );
    },
  ),

  acceptCareCircleInvitation: asyncHandler(
    async (req: Request, res: Response) => {
      const member =
        await elderCareDataService.acceptCareCircleInvitation(
          req.params.id!,
          req.user!,
        );

      res.locals.elderId = req.params.id;

      return ok(res, serializeCareCircleMember(member));
    },
  ),

  inviteCareCircleMember: asyncHandler(
    async (req: Request, res: Response) => {
      const member =
        await elderCareDataService.inviteCareCircleMember(
          req.params.id!,
          req.body,
          req.user!,
        );

      res.locals.elderId = req.params.id;

      return created(
        res,
        serializeCareCircleMember(member),
      );
    },
  ),

  updateCareCircleMember: asyncHandler(
    async (req: Request, res: Response) => {
      const member =
        await elderCareDataService.updateCareCircleMember(
          req.params.id!,
          req.params.userId!,
          req.body,
          req.user!,
        );

      res.locals.elderId = req.params.id;

      return ok(
        res,
        member ? serializeCareCircleMember(member) : null,
      );
    },
  ),

  removeCareCircleMember: asyncHandler(
    async (req: Request, res: Response) => {
      await elderCareDataService.removeCareCircleMember(
        req.params.id!,
        req.params.userId!,
        req.user!,
      );

      res.locals.elderId = req.params.id;

      return ok(res, null);
    },
  ),
};