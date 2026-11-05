import type { Request, Response } from "express";

import { asyncHandler } from "@/shared/utils/async.util";
import { created, ok, paginated } from "@/shared/utils/response.util";
import { caregiverService } from "@/modules/caregiver-service/services/caregiver.service";
import type { SearchQuery } from "@/modules/caregiver-service/validation/caregiver.validation";
import {
  serializeAdminCaregiver,
  serializeKycDocument,
  serializeOwnCaregiver,
  serializePublicCaregiver,
  serializeSlot,
} from "@/modules/caregiver-service/views/caregiver.view";
import type { CaregiverStatus } from "@/modules/caregiver-service/models/caregiver.model";

const userId = (req: Request) => req.user!.id;
const param = (req: Request, name: string) => String(req.params[name]);

export const caregiverController = {
  /* ---------- caregiver ---------- */

  create: asyncHandler(async (req: Request, res: Response) => {
    const { caregiver, documents } = await caregiverService.createProfile(userId(req), req.body);
    return created(res, serializeOwnCaregiver(caregiver, documents));
  }),

  getMine: asyncHandler(async (req: Request, res: Response) => {
    const { caregiver, documents } = await caregiverService.getMine(userId(req));
    return ok(res, serializeOwnCaregiver(caregiver, documents));
  }),

  updateMine: asyncHandler(async (req: Request, res: Response) => {
    const { caregiver, documents } = await caregiverService.updateMine(userId(req), req.body);
    return ok(res, serializeOwnCaregiver(caregiver, documents));
  }),

  createUploadUrl: asyncHandler(async (req: Request, res: Response) => {
    const upload = await caregiverService.createUploadUrl(userId(req), req.body);
    return ok(res, upload);
  }),

  uploadDocument: asyncHandler(async (req: Request, res: Response) => {
    const doc = await caregiverService.uploadDocument(userId(req), req.body);
    return created(res, serializeKycDocument(doc));
  }),

  replaceDocument: asyncHandler(async (req: Request, res: Response) => {
    const doc = await caregiverService.replaceDocument(userId(req), param(req, "docId"), req.body);
    return ok(res, serializeKycDocument(doc));
  }),

  deleteDocument: asyncHandler(async (req: Request, res: Response) => {
    await caregiverService.deleteDocument(userId(req), param(req, "docId"));
    return ok(res, { deleted: true });
  }),

  submit: asyncHandler(async (req: Request, res: Response) => {
    const { caregiver, documents } = await caregiverService.submit(userId(req));
    return ok(res, serializeOwnCaregiver(caregiver, documents));
  }),

  reApply: asyncHandler(async (req: Request, res: Response) => {
    const { caregiver, documents } = await caregiverService.reApply(userId(req));
    return ok(res, serializeOwnCaregiver(caregiver, documents));
  }),

  getAvailability: asyncHandler(async (req: Request, res: Response) => {
    const slots = await caregiverService.getMyAvailability(userId(req));
    return ok(res, slots.map(serializeSlot));
  }),

  setAvailability: asyncHandler(async (req: Request, res: Response) => {
    const slots = await caregiverService.replaceMyAvailability(userId(req), req.body);
    return ok(res, slots.map(serializeSlot));
  }),

  /* ---------- coordinator ---------- */

  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await caregiverService.list(
      { status: req.query.status as CaregiverStatus | undefined, flagged: req.query.flagged === "true" },
      req.query,
    );
    return paginated(res, { ...page, items: page.items.map((c) => serializeAdminCaregiver(c)) });
  }),

  // validate() has already replaced req.query with the parsed result, so it is NOT parsed again here.
  search: asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as SearchQuery;
    const caregivers = await caregiverService.search(query);
    return ok(res, caregivers.map(serializePublicCaregiver));
  }),

  /* ---------- family ---------- */

  // Families browse approved, available caregivers. Public view only: no KYC data, no user id, no exact location.
  browse: asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as SearchQuery;
    const caregivers = await caregiverService.search(query);
    return ok(res, caregivers.map(serializePublicCaregiver));
  }),

  getApplication: asyncHandler(async (req: Request, res: Response) => {
    const { caregiver, documents } = await caregiverService.getApplication(param(req, "id"));
    return ok(res, serializeAdminCaregiver(caregiver, documents));
  }),

  getDocumentUrl: asyncHandler(async (req: Request, res: Response) => {
    const result = await caregiverService.getDocumentUrl(param(req, "id"), param(req, "docId"));
    return ok(res, result);
  }),

  startReview: asyncHandler(async (req: Request, res: Response) => {
    const { caregiver, documents } = await caregiverService.startReview(param(req, "id"), userId(req));
    return ok(res, serializeAdminCaregiver(caregiver, documents));
  }),

  reviewDocument: asyncHandler(async (req: Request, res: Response) => {
    const { caregiver, documents } = await caregiverService.reviewDocument(
      param(req, "id"),
      param(req, "docId"),
      userId(req),
      req.body,
    );
    return ok(res, serializeAdminCaregiver(caregiver, documents));
  }),

  approve: asyncHandler(async (req: Request, res: Response) => {
    const { caregiver, documents } = await caregiverService.approve(param(req, "id"), userId(req));
    return ok(res, serializeAdminCaregiver(caregiver, documents));
  }),

  reject: asyncHandler(async (req: Request, res: Response) => {
    const { caregiver, documents } = await caregiverService.reject(param(req, "id"), req.body.reason);
    return ok(res, serializeAdminCaregiver(caregiver, documents));
  }),

  requestInfo: asyncHandler(async (req: Request, res: Response) => {
    const { caregiver, documents } = await caregiverService.requestInfo(param(req, "id"), req.body.note);
    return ok(res, serializeAdminCaregiver(caregiver, documents));
  }),

  /* ---------- admin ---------- */

  suspend: asyncHandler(async (req: Request, res: Response) => {
    const { caregiver, documents } = await caregiverService.suspend(param(req, "id"), req.body.reason);
    return ok(res, serializeAdminCaregiver(caregiver, documents));
  }),

  reinstate: asyncHandler(async (req: Request, res: Response) => {
    const { caregiver, documents } = await caregiverService.reinstate(param(req, "id"), userId(req));
    return ok(res, serializeAdminCaregiver(caregiver, documents));
  }),
};