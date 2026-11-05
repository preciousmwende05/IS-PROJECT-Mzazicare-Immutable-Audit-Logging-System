/**
 * U-CS 70 — Care Services Discovery & Catalog System
 * Owner(s): Leonard Kipkoech, Ilhan Hamud
 */

import { Types } from "mongoose";

import {
  CareServiceModel,
  PriceHistoryModel,
  ServiceCategoryModel,
  type CareService,
  type NewCareService,
  type NewPriceHistory,
  type NewServiceCategory,
  type PriceHistory,
  type ServiceCategory,
  type ServiceStatus,
} from "@/modules/catalog-service/models/catalog.model";

export type ServiceFilters = {
  status?: ServiceStatus;
  categoryId?: string;
  q?: string;
  minPrice?: number;
  maxPrice?: number;
};

const toWhere = (filters: ServiceFilters): Record<string, unknown> => {
  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;
  if (filters.categoryId) where.categoryId = new Types.ObjectId(filters.categoryId);
  if (filters.q) where.$text = { $search: filters.q };
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    where.basePriceCents = {
      ...(filters.minPrice !== undefined && { $gte: filters.minPrice }),
      ...(filters.maxPrice !== undefined && { $lte: filters.maxPrice }),
    };
  }
  return where;
};

/**
 * The only layer allowed to touch the database. Repositories answer data
 * questions ("find these rows"); they never decide anything.
 */
export const catalogRepository = {
  // ---------------- services ----------------

  findById: async (id: string): Promise<CareService | null> =>
    CareServiceModel.findById(id).lean<CareService>(),

  findBySlug: async (slug: string): Promise<CareService | null> =>
    CareServiceModel.findOne({ slug }).lean<CareService>(),

  findPage: async (
    filters: ServiceFilters,
    skip: number,
    limit: number,
  ): Promise<[CareService[], number]> => {
    const where = toWhere(filters);
    return Promise.all([
      CareServiceModel.find(where)
        .sort({ sortOrder: 1, name: 1 })
        .skip(skip)
        .limit(limit)
        .lean<CareService[]>(),
      CareServiceModel.countDocuments(where),
    ]);
  },

  create: async (data: NewCareService): Promise<CareService> => {
    const doc = await CareServiceModel.create(data);
    return doc.toObject() as CareService;
  },

  update: async (id: string, patch: Partial<NewCareService>): Promise<CareService | null> =>
    CareServiceModel.findByIdAndUpdate(id, patch, {
      new: true,
      runValidators: true,
    }).lean<CareService>(),

  /** Compare-and-set on status, so two admins racing cannot double-transition. */
  transition: async (
    id: string,
    from: ServiceStatus[],
    patch: Partial<NewCareService>,
  ): Promise<CareService | null> =>
    CareServiceModel.findOneAndUpdate({ _id: id, status: { $in: from } }, patch, {
      new: true,
    }).lean<CareService>(),

  countPublishedByCategory: async (): Promise<Map<string, number>> => {
    const rows = await CareServiceModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { status: "published" } },
      { $group: { _id: "$categoryId", count: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.count]));
  },

  // ---------------- categories ----------------

  findCategoryById: async (id: string): Promise<ServiceCategory | null> =>
    ServiceCategoryModel.findById(id).lean<ServiceCategory>(),

  findCategoryBySlug: async (slug: string): Promise<ServiceCategory | null> =>
    ServiceCategoryModel.findOne({ slug }).lean<ServiceCategory>(),

  findCategories: async (activeOnly: boolean): Promise<ServiceCategory[]> =>
    ServiceCategoryModel.find(activeOnly ? { active: true } : {})
      .sort({ sortOrder: 1, name: 1 })
      .lean<ServiceCategory[]>(),

  createCategory: async (data: NewServiceCategory): Promise<ServiceCategory> => {
    const doc = await ServiceCategoryModel.create(data);
    return doc.toObject() as ServiceCategory;
  },

  updateCategory: async (
    id: string,
    patch: Partial<NewServiceCategory>,
  ): Promise<ServiceCategory | null> =>
    ServiceCategoryModel.findByIdAndUpdate(id, patch, {
      new: true,
      runValidators: true,
    }).lean<ServiceCategory>(),

  // ---------------- price history ----------------

  appendPriceHistory: async (data: NewPriceHistory): Promise<PriceHistory> => {
    const doc = await PriceHistoryModel.create(data);
    return doc.toObject() as PriceHistory;
  },

  findPriceHistory: async (serviceId: string): Promise<PriceHistory[]> =>
    PriceHistoryModel.find({ serviceId }).sort({ effectiveFrom: -1 }).lean<PriceHistory[]>(),
};
