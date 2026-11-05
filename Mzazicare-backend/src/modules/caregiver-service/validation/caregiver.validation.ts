import { z } from "zod";

import {
  CAREGIVER_STATUSES,
  KYC_ALLOWED_MIME_TYPES,
  KYC_DOC_TYPES,
} from "@/modules/caregiver-service/models/caregiver.model";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const tag = z.string().trim().toLowerCase().min(2).max(50);
const reason = z.string().trim().min(5, "A reason of at least 5 characters is required").max(500);

// GeoJSON order: [longitude, latitude]. Kept inside Kenya's bounding box (with a small margin),
// which rejects the classic swapped latitude/longitude mistake, as elder-service does.
const location = z.object({
  coordinates: z.tuple([
    z.number().min(33.5, "Longitude must be inside Kenya (first value)").max(42),
    z.number().min(-5).max(5.5),
  ]),
});

const createProfileBody = z
  .object({
    bio: z.string().trim().min(10).max(1000),
    skills: z.array(tag).min(1).max(20),
    yearsExperience: z.number().min(0).max(60),
    serviceAreas: z.array(tag).min(1).max(20),
    baseLocation: location,
    hourlyRateCents: z.number().int().min(0),
  })
  .strict();

const updateProfileBody = createProfileBody
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");

const fileKey = z.string().regex(/^kyc\/[a-f\d]{24}\/[\w.-]+$/i, "Invalid file key");

// Step 1 of an upload: the caregiver asks for a presigned PUT URL. The file itself never passes through the API.
const uploadUrlBody = z
  .object({
    filename: z.string().trim().min(1).max(200),
    contentType: z.enum(KYC_ALLOWED_MIME_TYPES),
  })
  .strict();

// Step 2: once the PUT to RustFS has succeeded, the caregiver registers the document by its storage key.
const uploadDocumentBody = z
  .object({
    type: z.enum(KYC_DOC_TYPES),
    key: fileKey,
    issuedAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "good_conduct" && !v.expiresAt) {
      ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "expiresAt is required for good_conduct" });
    }
    if (v.expiresAt && v.expiresAt <= new Date()) {
      ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "expiresAt must be in the future" });
    }
    if (v.issuedAt && v.expiresAt && v.issuedAt >= v.expiresAt) {
      ctx.addIssue({ code: "custom", path: ["issuedAt"], message: "issuedAt must be before expiresAt" });
    }
  });

// Swaps the file behind an existing document (same upload-url flow). Type stays; dates are optional overrides.
const replaceDocumentBody = z
  .object({
    key: fileKey,
    issuedAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.expiresAt && v.expiresAt <= new Date()) {
      ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "expiresAt must be in the future" });
    }
  });

const reviewDocumentBody = z
  .object({
    status: z.enum(["verified", "rejected"]),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.status !== "rejected" || (v.note && v.note.length >= 5), {
    path: ["note"],
    message: "A note is required when rejecting a document",
  });

const slot = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((s) => s.startMinute < s.endMinute, "startMinute must be before endMinute");

const availabilityBody = z.object({
  slots: z
    .array(slot)
    .max(35)
    .superRefine((slots, ctx) => {
      const sorted = [...slots].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]!;
        const cur = sorted[i]!;
        if (prev.dayOfWeek === cur.dayOfWeek && cur.startMinute < prev.endMinute) {
          ctx.addIssue({ code: "custom", message: `Overlapping slots on day ${cur.dayOfWeek}` });
        }
      }
    }),
});

const searchQuery = z.object({
  skills: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) : [])),
  area: z.string().trim().toLowerCase().min(2),
  at: z.coerce.date(),
});

export type CreateProfileInput = z.infer<typeof createProfileBody>;
export type UpdateProfileInput = z.infer<typeof updateProfileBody>;
export type UploadUrlInput = z.infer<typeof uploadUrlBody>;
export type UploadDocumentInput = z.infer<typeof uploadDocumentBody>;
export type ReplaceDocumentInput = z.infer<typeof replaceDocumentBody>;
export type ReviewDocumentInput = z.infer<typeof reviewDocumentBody>;
export type AvailabilityInput = z.infer<typeof availabilityBody>;
// The parsed result: validate() has already replaced req.query with it (skills is a string[], at is a Date).
export type SearchQuery = z.output<typeof searchQuery>;

const idParam = z.object({ id: objectId });
const docParams = z.object({ id: objectId, docId: objectId });
const myDocParams = z.object({ docId: objectId });

export const caregiverValidation = {
  createProfile: z.object({ body: createProfileBody }),
  updateProfile: z.object({ body: updateProfileBody }),
  uploadUrl: z.object({ body: uploadUrlBody }),
  uploadDocument: z.object({ body: uploadDocumentBody }),
  replaceDocument: z.object({ params: myDocParams, body: replaceDocumentBody }),
  deleteMyDocument: z.object({ params: myDocParams }),
  setAvailability: z.object({ body: availabilityBody }),

  list: z.object({
    query: z.object({
      status: z.enum(CAREGIVER_STATUSES).optional(),
      flagged: z.enum(["true"]).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  }),

  search: z.object({ query: searchQuery }),

  byId: z.object({ params: idParam }),
  documentUrl: z.object({ params: docParams }),
  reviewDocument: z.object({ params: docParams, body: reviewDocumentBody }),
  reject: z.object({ params: idParam, body: z.object({ reason }) }),
  requestInfo: z.object({ params: idParam, body: z.object({ note: reason }) }),
  suspend: z.object({ params: idParam, body: z.object({ reason }) }),
};