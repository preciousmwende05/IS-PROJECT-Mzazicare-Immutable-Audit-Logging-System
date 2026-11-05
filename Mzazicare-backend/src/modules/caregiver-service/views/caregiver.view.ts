import {
  REAPPLY_COOLDOWN_DAYS,
  type AvailabilitySlot,
  type Caregiver,
  type KycDocument,
} from "@/modules/caregiver-service/models/caregiver.model";

const iso = (d?: Date | null) => (d ? d.toISOString() : null);
const idOrNull = (v?: unknown) => (v ? String(v) : null);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** A document as the client sees it. fileKey is deliberately absent. */
export const serializeKycDocument = (d: KycDocument) => ({
  id: String(d._id),
  type: d.type,
  status: d.status,
  originalName: d.originalName,
  issuedAt: iso(d.issuedAt),
  expiresAt: iso(d.expiresAt),
  reviewNote: d.reviewNote ?? null,
  uploadedAt: iso(d.createdAt),
});

/**
 * Public view (families browsing / matching results).
 * No KYC data, no ID numbers, no rejection reason, no user id, no exact base location.
 */
export const serializePublicCaregiver = (c: Caregiver) => ({
  id: String(c._id),
  bio: c.bio,
  skills: c.skills,
  yearsExperience: c.yearsExperience,
  serviceAreas: c.serviceAreas,
  hourlyRateCents: c.hourlyRateCents,
  ratingAverage: round2(c.ratingAverage),
  ratingCount: c.ratingCount,
});

/** The caregiver's own view: they are allowed to see WHY they were rejected or suspended. */
export const serializeOwnCaregiver = (c: Caregiver, documents: KycDocument[] = []) => ({
  ...serializePublicCaregiver(c),
  status: c.status,
  baseLocation: { coordinates: c.baseLocation?.coordinates ?? [] },
  rejectionReason: c.rejectionReason ?? null,
  suspendedReason: c.suspendedReason ?? null,
  infoRequest: c.infoRequest ?? null,
  canReapplyAt:
    c.status === "rejected" && c.rejectedAt
      ? new Date(c.rejectedAt.getTime() + REAPPLY_COOLDOWN_DAYS * 86_400_000).toISOString()
      : null,
  documents: documents.map(serializeKycDocument),
});

/** Coordinator / admin view. Still no fileKey: files are reached only via signed URL. */
export const serializeAdminCaregiver = (c: Caregiver, documents: KycDocument[] = []) => ({
  ...serializeOwnCaregiver(c, documents),
  userId: String(c.userId),
  reviewerId: idOrNull(c.reviewerId),
  approvedAt: iso(c.approvedAt),
  approvedBy: idOrNull(c.approvedBy),
  rejectedAt: iso(c.rejectedAt),
  noShowCount: c.noShowCount,
  flaggedForReview: c.flaggedForReview,
  createdAt: iso(c.createdAt),
  updatedAt: iso(c.updatedAt),
});

export const serializeSlot = (s: AvailabilitySlot) => ({
  dayOfWeek: s.dayOfWeek,
  startMinute: s.startMinute,
  endMinute: s.endMinute,
});