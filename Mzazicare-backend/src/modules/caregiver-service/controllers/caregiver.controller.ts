import type { Request, Response } from "express";

import { asyncHandler } from "@/shared/utils/async.util";
import { authService } from "@/modules/auth-service/services/auth.service";
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
import type {
  Caregiver,
  CaregiverStatus,
  KycDocument,
} from "@/modules/caregiver-service/models/caregiver.model";

const userId = (req: Request) => req.user!.id;
const param = (req: Request, name: string) => String(req.params[name]);

/**
 * The coordinator/admin view plus the applicant's name, so reviewers (and the
 * visit assignment list) see "Mercy Chebet", not an id. Names come from
 * auth-service in one batched lookup per response.
 */
const withNames = async (rows: Array<{ caregiver: Caregiver; documents?: KycDocument[] }>) => {
  const names = await authService.getDisplayNames(rows.map((r) => String(r.caregiver.userId)));
  return rows.map(({ caregiver, documents }) => ({
    ...serializeAdminCaregiver(caregiver, documents),
    fullName: names.get(String(caregiver.userId))?.name ?? null,
  }));
};
const adminView = async (caregiver: Caregiver, documents: KycDocument[]) =>
  (await withNames([{ caregiver, documents }]))[0];

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
    return paginated(res, { ...page, items: await withNames(page.items.map((caregiver) => ({ caregiver }))) });
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
    return ok(res, await adminView(caregiver, documents));
  }),

  getDocumentUrl: asyncHandler(async (req: Request, res: Response) => {
    const result = await caregiverService.getDocumentUrl(param(req, "id"), param(req, "docId"));
    return ok(res, result);
  }),

  startReview: asyncHandler(async (req: Request, res: Response) => {
    const { caregiver, documents } = await caregiverService.startReview(param(req, "id"), userId(req));
    return ok(res, await adminView(caregiver, documents));
  }),

  reviewDocument: asyncHandler(async (req: Request, res: Response) => {
    const { caregiver, documents } = await caregiverService.reviewDocument(
      param(req, "id"),
      param(req, "docId"),
      userId(req),
      req.body,
    );
    return ok(res, await adminView(caregiver, documents));
  }),

  approve: asyncHandler(async (req: Request, res: Response) => {
    const { caregiver, documents } = await caregiverService.approve(param(req, "id"), userId(req));
    return ok(res, await adminView(caregiver, documents));
  }),

  reject: asyncHandler(async (req: Request, res: Response) => {
    const { caregiver, documents } = await caregiverService.reject(param(req, "id"), req.body.reason);
    return ok(res, await adminView(caregiver, documents));
  }),

  requestInfo: asyncHandler(async (req: Request, res: Response) => {
    const { caregiver, documents } = await caregiverService.requestInfo(param(req, "id"), req.body.note);
    return ok(res, await adminView(caregiver, documents));
  }),

  /* ---------- admin ---------- */

  suspend: asyncHandler(async (req: Request, res: Response) => {
    const { caregiver, documents } = await caregiverService.suspend(param(req, "id"), req.body.reason);
    return ok(res, await adminView(caregiver, documents));
  }),

  reinstate: asyncHandler(async (req: Request, res: Response) => {
    const { caregiver, documents } = await caregiverService.reinstate(param(req, "id"), userId(req));
    return ok(res, await adminView(caregiver, documents));
  }),
};