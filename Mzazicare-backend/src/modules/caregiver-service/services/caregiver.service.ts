import logger from "@/shared/config/logger";
import { publish } from "@/shared/events/bus";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@/shared/errors";
import { buildPage, parsePagination } from "@/shared/utils/pagination.util";
import { DEFAULT_SIGNED_URL_TTL_SECONDS } from "@/shared/config/storage";
import { storageService } from "@/shared/services/storage.service";
import {
  KYC_ALLOWED_MIME_TYPES,
  KYC_MAX_FILE_BYTES,
  KYC_ORPHAN_GRACE_MS,
  KYC_REGISTER_WINDOW_MS,
  REAPPLY_COOLDOWN_DAYS,
  REQUIRED_KYC_DOC_TYPES,
  type Caregiver,
  type CaregiverStatus,
  type KycDocStatus,
  type KycDocType,
  type KycDocument,
} from "@/modules/caregiver-service/models/caregiver.model";
import {
  availabilityRepository,
  caregiverRepository,
  kycDocumentRepository,
  type CaregiverPatch,
} from "@/modules/caregiver-service/repository/caregiver.repository";
import { canTransition } from "@/modules/caregiver-service/services/caregiver.state";
import type {
  AvailabilityInput,
  CreateProfileInput,
  ReplaceDocumentInput,
  ReviewDocumentInput,
  UpdateProfileInput,
  UploadDocumentInput,
  UploadUrlInput,
} from "@/modules/caregiver-service/validation/caregiver.validation";

// Swap for the shared constant if shared/config already exports KYC_SIGNED_URL_TTL_SECONDS.
const KYC_SIGNED_URL_TTL_SECONDS = 300;
const NO_SHOW_FLAG_THRESHOLD = 3;
const DAY_MS = 86_400_000;
const ORPHAN_SWEEP_BATCH = 500;

const UPLOAD_ALLOWED: CaregiverStatus[] = ["draft", "more_info", "expired", "approved"];
// A verified document is the record of what a coordinator checked, so it is never swapped out.
// Renewing one (e.g. a new good conduct certificate) is a new upload, not a replacement.
const REPLACEABLE_DOC_STATUSES: KycDocStatus[] = ["pending", "rejected"];
const EDIT_ALLOWED: CaregiverStatus[] = ["draft", "approved"];

export type UploadUrl = {
  key: string;
  url: string;
  method: "PUT";
  headers: { "Content-Type": string };
  maxBytes: number;
  expiresInSeconds: number;
};
export type CaregiverWithDocs = { caregiver: Caregiver; documents: KycDocument[] };

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const unique = (xs: string[]) => [...new Set(xs)];
const isDuplicateKey = (err: unknown) => (err as { code?: number }).code === 11000;

const requireReason = (text: string | undefined, what: string): string => {
  const trimmed = text?.trim();
  if (!trimmed || trimmed.length < 5) throw new BadRequestError(`${what} is required`);
  return trimmed;
};

const assertCanUpload = (caregiver: Caregiver) => {
  if (!UPLOAD_ALLOWED.includes(caregiver.status)) {
    throw new ConflictError(`Documents cannot be uploaded while the application is "${caregiver.status}"`);
  }
};

// Every caregiver uploads under their own prefix, so a key can be checked for ownership without a lookup.
const kycFolder = (caregiver: Caregiver) => `kyc/${String(caregiver._id)}`;

// storageService keys are "<folder>/<uuid>-<sanitised name>"; strip the folder and the 36-char uuid + dash.
const originalNameFromKey = (key: string) => key.slice(key.lastIndexOf("/") + 1).slice(37) || "document";

/** Best-effort file delete: the record is already gone or repointed, so a failure only leaves an orphan for the sweep. */
const removeFileQuietly = (key: string) =>
  storageService
    .remove(key)
    .catch((err: unknown) =>
      logger.warn(`[caregiver] could not remove ${key} from storage: ${(err as Error).message}`),
    );

/**
 * Checks a file the client PUT to RustFS before it is attached to a document: owned by this
 * caregiver, not already in use, recent, and a PDF/JPEG/PNG of at most 5 MB. A bad file is deleted.
 */
const verifyUploadedFile = async (caregiver: Caregiver, key: string) => {
  if (!key.startsWith(`${kycFolder(caregiver)}/`)) {
    throw new ForbiddenError("That file was not uploaded by this caregiver");
  }
  if (await kycDocumentRepository.existsByFileKey(key)) {
    throw new ConflictError("That file is already attached to a document");
  }

  const stored = await storageService.stat(key);
  if (!stored) throw new BadRequestError("File not found. Upload it to the presigned URL first.");
  // Past this window the orphan sweep may delete the file, so it can no longer be registered.
  if (Date.now() - stored.lastModified.getTime() > KYC_REGISTER_WINDOW_MS) {
    await storageService.remove(key);
    throw new BadRequestError("This upload has expired. Request a new upload URL and upload the file again.");
  }

  const mimeType = stored.contentType.split(";")[0]!.trim().toLowerCase();
  const validType = (KYC_ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
  const validSize = stored.sizeBytes > 0 && stored.sizeBytes <= KYC_MAX_FILE_BYTES;
  if (!validType || !validSize) {
    await storageService.remove(key);
    throw new BadRequestError("A PDF, JPEG or PNG file up to 5 MB is required");
  }
  return { fileKey: key, mimeType, originalName: originalNameFromKey(key) };
};

const loadCaregiver = async (id: string): Promise<Caregiver> => {
  const caregiver = await caregiverRepository.findById(id);
  if (!caregiver) throw new NotFoundError("Caregiver");
  return caregiver;
};

const loadOwn = async (userId: string): Promise<Caregiver> => {
  const caregiver = await caregiverRepository.findByUserId(userId);
  if (!caregiver) throw new NotFoundError("Caregiver profile");
  return caregiver;
};

/** A document must belong to the caregiver in the URL, otherwise anyone could read any document id. */
const loadDocumentOf = async (caregiverId: string, docId: string): Promise<KycDocument> => {
  const doc = await kycDocumentRepository.findById(docId);
  if (!doc || String(doc.caregiverId) !== caregiverId) throw new NotFoundError("Document");
  return doc;
};

const withDocuments = async (caregiver: Caregiver): Promise<CaregiverWithDocs> => ({
  caregiver,
  documents: await kycDocumentRepository.findByCaregiver(String(caregiver._id)),
});

const isLive = (doc: KycDocument, now: Date) => !doc.expiresAt || doc.expiresAt > now;

/** Required types with no pending-or-verified, unexpired document: what a submission is missing. */
const missingRequiredTypes = (docs: KycDocument[], now: Date): KycDocType[] =>
  REQUIRED_KYC_DOC_TYPES.filter(
    (type) => !docs.some((d) => d.type === type && d.status !== "rejected" && isLive(d, now)),
  );

/** Every required type has a verified, unexpired document. The bar for approval and reinstatement. */
const hasValidRequiredDocs = (docs: KycDocument[], now: Date): boolean =>
  REQUIRED_KYC_DOC_TYPES.every((type) =>
    docs.some((d) => d.type === type && d.status === "verified" && isLive(d, now)),
  );

/** The single guarded status change. Illegal move -> 409. Lost a race -> 409. */
const transition = async (
  caregiver: Caregiver,
  to: CaregiverStatus,
  patch: CaregiverPatch = {},
): Promise<Caregiver> => {
  if (!canTransition(caregiver.status, to)) {
    throw new ConflictError(`A caregiver in "${caregiver.status}" cannot move to "${to}"`);
  }
  const updated = await caregiverRepository.transition(String(caregiver._id), caregiver.status, to, patch);
  if (!updated) throw new ConflictError("This application was just changed by someone else. Reload and try again.");
  return updated;
};

/* ------------------------------------------------------------------ */
/* service                                                             */
/* ------------------------------------------------------------------ */

export const caregiverService = {
  /* ---------- caregiver: profile ---------- */

  createProfile: async (userId: string, input: CreateProfileInput): Promise<CaregiverWithDocs> => {
    if (await caregiverRepository.findByUserId(userId)) {
      throw new ConflictError("A caregiver profile already exists for this account");
    }
    try {
      const caregiver = await caregiverRepository.create({
        userId,
        bio: input.bio,
        skills: unique(input.skills),
        yearsExperience: input.yearsExperience,
        serviceAreas: unique(input.serviceAreas),
        baseLocation: { type: "Point", coordinates: input.baseLocation.coordinates },
        hourlyRateCents: input.hourlyRateCents,
      });
      return { caregiver, documents: [] };
    } catch (err) {
      if (isDuplicateKey(err)) throw new ConflictError("A caregiver profile already exists for this account");
      throw err;
    }
  },

  getMine: async (userId: string): Promise<CaregiverWithDocs> => withDocuments(await loadOwn(userId)),

  updateMine: async (userId: string, input: UpdateProfileInput): Promise<CaregiverWithDocs> => {
    const current = await loadOwn(userId);
    if (!EDIT_ALLOWED.includes(current.status)) {
      throw new ConflictError(`A profile cannot be edited while it is "${current.status}"`);
    }
    // Pick fields explicitly: never spread client input into an update.
    const patch: CaregiverPatch = {};
    if (input.bio !== undefined) patch.bio = input.bio;
    if (input.skills !== undefined) patch.skills = unique(input.skills);
    if (input.yearsExperience !== undefined) patch.yearsExperience = input.yearsExperience;
    if (input.serviceAreas !== undefined) patch.serviceAreas = unique(input.serviceAreas);
    if (input.hourlyRateCents !== undefined) patch.hourlyRateCents = input.hourlyRateCents;
    if (input.baseLocation) patch.baseLocation = { type: "Point", coordinates: input.baseLocation.coordinates };

    const updated = await caregiverRepository.updateWhileIn(String(current._id), EDIT_ALLOWED, patch);
    if (!updated) throw new ConflictError("The profile changed state while you were editing. Reload and try again.");
    return withDocuments(updated);
  },

  /* ---------- caregiver: documents ---------- */

  /**
   * Step 1 of an upload. Returns a short-lived presigned PUT URL; the client sends the file
   * straight to RustFS, so the bytes never pass through (or sit in the memory of) the API.
   */
  createUploadUrl: async (userId: string, input: UploadUrlInput): Promise<UploadUrl> => {
    const caregiver = await loadOwn(userId);
    assertCanUpload(caregiver);
    const { key, url } = await storageService.signedUploadUrl(kycFolder(caregiver), input.filename);
    return {
      key,
      url,
      method: "PUT",
      headers: { "Content-Type": input.contentType },
      maxBytes: KYC_MAX_FILE_BYTES,
      expiresInSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS,
    };
  },

  /**
   * Step 2. Registers a file the client has already PUT to RustFS. A presigned PUT cannot limit
   * size or type, so both are checked against the stored object here; a bad object is deleted.
   */
  uploadDocument: async (userId: string, input: UploadDocumentInput): Promise<KycDocument> => {
    const caregiver = await loadOwn(userId);
    assertCanUpload(caregiver);
    const file = await verifyUploadedFile(caregiver, input.key);
    return kycDocumentRepository.create({
      caregiverId: String(caregiver._id),
      type: input.type,
      ...file,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
    });
  },

  /**
   * Swaps the file behind a pending or rejected document (the usual answer to "more info").
   * The document goes back to pending and the original file is deleted from RustFS.
   */
  replaceDocument: async (userId: string, docId: string, input: ReplaceDocumentInput): Promise<KycDocument> => {
    const caregiver = await loadOwn(userId);
    assertCanUpload(caregiver);
    const doc = await loadDocumentOf(String(caregiver._id), docId);
    if (!REPLACEABLE_DOC_STATUSES.includes(doc.status)) {
      throw new ConflictError("A verified document cannot be replaced. Upload a new document instead.");
    }
    const issuedAt = input.issuedAt ?? doc.issuedAt ?? undefined;
    const expiresAt = input.expiresAt ?? doc.expiresAt ?? undefined;
    if (issuedAt && expiresAt && issuedAt >= expiresAt) {
      throw new BadRequestError("issuedAt must be before expiresAt");
    }

    const file = await verifyUploadedFile(caregiver, input.key);
    // Repoint the record first, then delete the original: if anything fails part-way the
    // document still has a file, and the worst case is an orphan the nightly sweep removes.
    const updated = await kycDocumentRepository.replaceFile(String(doc._id), REPLACEABLE_DOC_STATUSES, {
      ...file,
      issuedAt,
      expiresAt,
    });
    if (!updated) {
      await removeFileQuietly(file.fileKey);
      throw new ConflictError("The document was reviewed while you were replacing it. Reload and try again.");
    }
    await removeFileQuietly(doc.fileKey);
    return updated;
  },

  deleteDocument: async (userId: string, docId: string): Promise<void> => {
    const caregiver = await loadOwn(userId);
    if (caregiver.status !== "draft") {
      throw new ConflictError("Documents can only be removed while the application is a draft");
    }
    const doc = await loadDocumentOf(String(caregiver._id), docId);
    // Record first, then the file: a failed file delete leaves an orphan object, never a record pointing at nothing.
    await kycDocumentRepository.deleteById(String(doc._id));
    await removeFileQuietly(doc.fileKey);
  },

  submit: async (userId: string): Promise<CaregiverWithDocs> => {
    const caregiver = await loadOwn(userId);
    if (!canTransition(caregiver.status, "submitted")) {
      throw new ConflictError(`An application in "${caregiver.status}" cannot be submitted`);
    }
    const docs = await kycDocumentRepository.findByCaregiver(String(caregiver._id));
    const missing = missingRequiredTypes(docs, new Date());
    if (missing.length > 0) {
      throw new BadRequestError(`Missing required documents: ${missing.join(", ")}`);
    }
    const updated = await transition(caregiver, "submitted", { infoRequest: null });
    await publish("caregiver.kyc.submitted", { caregiverId: String(updated._id) });
    return { caregiver: updated, documents: docs };
  },

  reApply: async (userId: string): Promise<CaregiverWithDocs> => {
    const caregiver = await loadOwn(userId);
    if (caregiver.status !== "rejected") throw new ConflictError("Only a rejected application can be re-applied");
    const availableAt = new Date((caregiver.rejectedAt ?? new Date(0)).getTime() + REAPPLY_COOLDOWN_DAYS * DAY_MS);
    if (availableAt > new Date()) {
      throw new ForbiddenError(`You can re-apply from ${availableAt.toISOString().slice(0, 10)}`);
    }
    const updated = await transition(caregiver, "draft", { rejectionReason: null });
    // Fresh start: drop the old records, then their files.
    const oldDocs = await kycDocumentRepository.findByCaregiver(String(updated._id));
    await kycDocumentRepository.deleteByCaregiver(String(updated._id));
    await Promise.all(oldDocs.map((d) => removeFileQuietly(d.fileKey)));
    return { caregiver: updated, documents: [] };
  },

  /* ---------- caregiver: availability ---------- */

  getMyAvailability: async (userId: string) => {
    const caregiver = await loadOwn(userId);
    return availabilityRepository.findByCaregiver(String(caregiver._id));
  },

  replaceMyAvailability: async (userId: string, input: AvailabilityInput) => {
    const caregiver = await loadOwn(userId);
    await availabilityRepository.replaceAll(String(caregiver._id), input.slots);
    return availabilityRepository.findByCaregiver(String(caregiver._id));
  },

  /* ---------- coordinator: reading ---------- */

  list: async (
    filters: { status?: CaregiverStatus; flagged?: boolean },
    query: { page?: unknown; limit?: unknown },
  ) => {
    const { page, limit, skip } = parsePagination(query);
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.flagged) where.flaggedForReview = true;
    const [items, total] = await caregiverRepository.findPage(where, skip, limit);
    return buildPage(items, total, page, limit);
  },

  getApplication: async (id: string): Promise<CaregiverWithDocs> => withDocuments(await loadCaregiver(id)),

  /** Short-lived signed URL. The route is coordinator-only and audited on every call. */
  getDocumentUrl: async (caregiverId: string, docId: string) => {
    const caregiver = await loadCaregiver(caregiverId);
    const doc = await loadDocumentOf(String(caregiver._id), docId);
    const url = await storageService.signedUrl(doc.fileKey, KYC_SIGNED_URL_TTL_SECONDS);
    return { url, expiresInSeconds: KYC_SIGNED_URL_TTL_SECONDS };
  },

  /* ---------- coordinator: workflow ---------- */

  startReview: async (id: string, coordinatorId: string): Promise<CaregiverWithDocs> => {
    const caregiver = await loadCaregiver(id);
    const updated = await transition(caregiver, "under_review", { reviewerId: coordinatorId });
    return withDocuments(updated);
  },

  reviewDocument: async (
    id: string,
    docId: string,
    coordinatorId: string,
    input: ReviewDocumentInput,
  ): Promise<CaregiverWithDocs> => {
    const caregiver = await loadCaregiver(id);
    if (caregiver.status !== "under_review") {
      throw new ConflictError("Documents can only be reviewed while the case is under review");
    }
    const doc = await loadDocumentOf(String(caregiver._id), docId);
    const note = input.status === "rejected" ? requireReason(input.note, "A note explaining the rejection") : input.note ?? null;
    await kycDocumentRepository.updateById(String(doc._id), {
      status: input.status,
      reviewNote: note,
      reviewedBy: coordinatorId,
      reviewedAt: new Date(),
    });
    return withDocuments(caregiver);
  },

  approve: async (id: string, coordinatorId: string): Promise<CaregiverWithDocs> => {
    const caregiver = await loadCaregiver(id);
    if (!canTransition(caregiver.status, "approved") || caregiver.status !== "under_review") {
      throw new ConflictError(`An application in "${caregiver.status}" cannot be approved`);
    }
    const docs = await kycDocumentRepository.findByCaregiver(String(caregiver._id));
    if (docs.some((d) => d.status === "pending")) {
      throw new ConflictError("Every uploaded document must be verified or rejected before approval");
    }
    if (!hasValidRequiredDocs(docs, new Date())) {
      throw new BadRequestError("A verified, unexpired national_id and good_conduct document are required");
    }
    const updated = await transition(caregiver, "approved", {
      approvedAt: new Date(),
      approvedBy: coordinatorId,
      rejectionReason: null,
      suspendedReason: null,
      infoRequest: null,
    });
    await publish("caregiver.approved", { caregiverId: String(updated._id), approvedBy: coordinatorId });
    return { caregiver: updated, documents: docs };
  },

  reject: async (id: string, reason: string): Promise<CaregiverWithDocs> => {
    const text = requireReason(reason, "A rejection reason");
    const caregiver = await loadCaregiver(id);
    const updated = await transition(caregiver, "rejected", { rejectedAt: new Date(), rejectionReason: text });
    await publish("caregiver.rejected", { caregiverId: String(updated._id), reason: text });
    return withDocuments(updated);
  },

  requestInfo: async (id: string, note: string): Promise<CaregiverWithDocs> => {
    const text = requireReason(note, "A note saying what the caregiver must re-upload");
    const caregiver = await loadCaregiver(id);
    const updated = await transition(caregiver, "more_info", { infoRequest: text });
    return withDocuments(updated);
  },

  /* ---------- admin ---------- */

  suspend: async (id: string, reason: string): Promise<CaregiverWithDocs> => {
    const text = requireReason(reason, "A suspension reason");
    const caregiver = await loadCaregiver(id);
    const updated = await transition(caregiver, "suspended", { suspendedReason: text });
    // booking-service releases this caregiver's future bookings on this event.
    await publish("caregiver.suspended", { caregiverId: String(updated._id), reason: text });
    return withDocuments(updated);
  },

  reinstate: async (id: string, adminId: string): Promise<CaregiverWithDocs> => {
    const caregiver = await loadCaregiver(id);
    if (caregiver.status !== "suspended") throw new ConflictError("Only a suspended caregiver can be reinstated");
    const docs = await kycDocumentRepository.findByCaregiver(String(caregiver._id));
    if (!hasValidRequiredDocs(docs, new Date())) {
      throw new BadRequestError("Cannot reinstate: a required document is missing, unverified or expired");
    }
    const updated = await transition(caregiver, "approved", { suspendedReason: null });
    await publish("caregiver.approved", { caregiverId: String(updated._id), approvedBy: adminId });
    return { caregiver: updated, documents: docs };
  },

  /* ---------- for other modules ---------- */

  /** booking-service calls this on every assignment. Only "approved" passes. */
  isAssignable: async (caregiverId: string): Promise<boolean> => {
    const caregiver = await caregiverRepository.findById(caregiverId);
    return caregiver?.status === "approved";
  },

  /**
   * The caregiver profile id of a logged-in user, or null when they have none.
   * booking-service (CaregiverPort) and visit-service (caregiver directory)
   * both need this: tokens carry a user id, visits and bookings a caregiver id.
   */
  getCaregiverIdForUser: async (userId: string): Promise<string | null> => {
    const caregiver = await caregiverRepository.findByUserId(userId);
    return caregiver ? String(caregiver._id) : null;
  },

  search: async (query: { skills: string[]; area: string; at: Date }) =>
    caregiverRepository.findAssignable(query.skills, query.area, query.at),

  /* ---------- event handlers (idempotent) ---------- */

  // feedback.submitted carries a visitId, not a feedback id: one rating per visit, so the visit is the idempotency key.
  recordRating: async (visitId: string, caregiverId: string, rating: number): Promise<void> => {
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) return;
    const key = `feedback:${visitId}`;
    if (!(await caregiverRepository.markEventProcessed(key))) return; // duplicate delivery
    try {
      await caregiverRepository.applyRating(caregiverId, rating);
    } catch (err) {
      await caregiverRepository.unmarkEventProcessed(key); // let the retry run
      throw err;
    }
  },

  recordVisit: async (visitId: string, caregiverId: string): Promise<void> => {
    await caregiverRepository.recordVisit(visitId, caregiverId);
  },

  caregiverIdForVisit: (visitId: string): Promise<string | null> =>
    caregiverRepository.findCaregiverIdForVisit(visitId),

  recordNoShow: async (visitId: string, caregiverId: string): Promise<void> => {
    const key = `visit-missed:${visitId}`;
    if (!(await caregiverRepository.markEventProcessed(key))) return;
    try {
      const count = await caregiverRepository.incrementNoShows(caregiverId);
      if (count !== null && count >= NO_SHOW_FLAG_THRESHOLD) await caregiverRepository.flagForReview(caregiverId);
    } catch (err) {
      await caregiverRepository.unmarkEventProcessed(key);
      throw err;
    }
  },

  /* ---------- daily sweep (called by the worker) ---------- */

  runExpirySweep: async (now: Date = new Date()) => {
    // Expire approved caregivers whose required documents have lapsed.
    let expired = 0;
    const candidates = unique((await kycDocumentRepository.findLapsed(now)).map((d) => String(d.caregiverId)));
    for (const id of candidates) {
      const caregiver = await caregiverRepository.findById(id);
      if (!caregiver || caregiver.status !== "approved") continue;
      const docs = await kycDocumentRepository.findByCaregiver(id);
      if (hasValidRequiredDocs(docs, now)) continue; // a renewed document covers it

      // Publish FIRST: if this crashes before the status change, tomorrow's sweep
      // finds the caregiver still "approved" and publishes again. Releasing bookings is safe to repeat.
      await publish("caregiver.suspended", {
        caregiverId: id,
        reason: "A required document has expired",
      });
      const updated = await caregiverRepository.transition(id, "approved", "expired", {
        suspendedReason: "A required document has expired",
      });
      if (updated) expired++;
    }
    return { expired };
  },

  /**
   * Deletes KYC files that no document references: uploads that were never registered,
   * and files whose removal failed in deleteDocument. Only files older than
   * KYC_ORPHAN_GRACE_MS are considered, so an upload in progress is never touched.
   */
  runOrphanFileSweep: async (now: Date = new Date()) => {
    const cutoff = now.getTime() - KYC_ORPHAN_GRACE_MS;
    let scanned = 0;
    let removed = 0;

    const sweepBatch = async (keys: string[]) => {
      const referenced = await kycDocumentRepository.findReferencedFileKeys(keys);
      for (const key of keys) {
        if (referenced.has(key)) continue;
        try {
          await storageService.remove(key);
          removed++;
        } catch (err) {
          logger.warn(`[caregiver] orphan sweep could not remove ${key}: ${(err as Error).message}`);
        }
      }
    };

    let batch: string[] = [];
    for await (const obj of storageService.list("kyc/")) {
      scanned++;
      if (obj.lastModified.getTime() > cutoff) continue;
      batch.push(obj.key);
      if (batch.length >= ORPHAN_SWEEP_BATCH) {
        await sweepBatch(batch);
        batch = [];
      }
    }
    if (batch.length) await sweepBatch(batch);
    return { scanned, removed };
  },
};