/**
 * U-CS 70 — Care Services Discovery & Catalog System
 * Owner(s): Leonard Kipkoech, Ilhan Hamud
 */

import type {
  CareService,
  PriceHistory,
  ServiceCategory,
} from "@/modules/catalog-service/models/catalog.model";

/**
 * The shape the API returns. Views exist so that a document can never leak a
 * field by accident — add a field here deliberately or the client never sees it.
 */

/** What families see. No status, no internal flags. */
export type CareServiceView = {
  id: string;
  name: string;
  slug: string;
  categoryId: string;
  description: string;
  basePriceCents: number;
  pricingUnit: string;
  minimumDurationMinutes: number;
  requiredSkills: string[];
};

/** What admins see: the public view plus lifecycle and bookkeeping. */
export type CareServiceAdminView = CareServiceView & {
  status: string;
  sortOrder: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ServiceCategoryView = {
  id: string;
  name: string;
  slug: string;
  description: string;
  iconKey: string | null;
  sortOrder: number;
  active: boolean;
  serviceCount?: number;
};

export type PriceHistoryView = {
  id: string;
  serviceId: string;
  oldPriceCents: number;
  newPriceCents: number;
  changedBy: string;
  effectiveFrom: string;
};

const iso = (d: Date | string | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

export const serializeCareService = (s: CareService): CareServiceView => ({
  id: String(s._id),
  name: s.name,
  slug: s.slug,
  categoryId: String(s.categoryId),
  description: s.description ?? "",
  basePriceCents: s.basePriceCents,
  pricingUnit: s.pricingUnit,
  minimumDurationMinutes: s.minimumDurationMinutes,
  requiredSkills: [...(s.requiredSkills ?? [])],
});

export const serializeCareServiceAdmin = (s: CareService): CareServiceAdminView => ({
  ...serializeCareService(s),
  status: s.status,
  sortOrder: s.sortOrder ?? 0,
  publishedAt: iso(s.publishedAt),
  createdAt: iso(s.createdAt)!,
  updatedAt: iso(s.updatedAt)!,
});

export const serializeCategory = (
  c: ServiceCategory,
  serviceCount?: number,
): ServiceCategoryView => ({
  id: String(c._id),
  name: c.name,
  slug: c.slug,
  description: c.description ?? "",
  iconKey: c.iconKey ?? null,
  sortOrder: c.sortOrder ?? 0,
  active: c.active ?? true,
  ...(serviceCount !== undefined && { serviceCount }),
});

export const serializePriceHistory = (p: PriceHistory): PriceHistoryView => ({
  id: String(p._id),
  serviceId: String(p.serviceId),
  oldPriceCents: p.oldPriceCents,
  newPriceCents: p.newPriceCents,
  changedBy: String(p.changedBy),
  effectiveFrom: iso(p.effectiveFrom)!,
});
