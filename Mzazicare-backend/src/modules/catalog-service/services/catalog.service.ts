/**
 * U-CS 70 — Care Services Discovery & Catalog System
 * Owner(s): Leonard Kipkoech, Ilhan Hamud
 */

import { Types } from "mongoose";

import logger from "@/shared/config/logger";
import { ConflictError, NotFoundError, UnprocessableError } from "@/shared/errors";
import { publish } from "@/shared/events/bus";
import { cache } from "@/shared/helpers/cache.helper";
import type { Paginated } from "@/shared/types";
import { buildPage } from "@/shared/utils/pagination.util";
import type {
  CareService,
  NewCareService,
  PriceHistory,
  ServiceCategory,
} from "@/modules/catalog-service/models/catalog.model";
import {
  catalogRepository,
  type ServiceFilters,
} from "@/modules/catalog-service/repository/catalog.repository";
import type {
  CreateCategoryInput,
  CreateServiceInput,
  ListServicesQuery,
  UpdateCategoryInput,
  UpdateServiceInput,
} from "@/modules/catalog-service/validation/catalog.validation";
import {
  serializeCareService,
  serializeCategory,
  type CareServiceView,
  type ServiceCategoryView,
} from "@/modules/catalog-service/views/catalog.view";

/**
 * Every business rule for U-CS 70 lives here.
 *
 * No express types in this file. If you cannot call a function from a worker
 * or a seed script, it is in the wrong layer.
 */

const CACHE_TTL_SECONDS = 300;
const CACHE_NAMESPACE = "catalog:*";

/** What booking-service needs to price and staff a booking. */
export type BookableService = {
  id: string;
  basePriceCents: number;
  pricingUnit: CareService["pricingUnit"];
  minimumDurationMinutes: number;
  requiredSkills: string[];
};

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);

const isDuplicateKey = (err: unknown): boolean => (err as { code?: number })?.code === 11000;

/**
 * Cached reads are cleared on every write, synchronously, so an admin who
 * edits a price sees the new one on the next request. A failed invalidation
 * must not fail the write itself: the TTL bounds the staleness.
 */
const invalidateCache = async (): Promise<void> => {
  try {
    await cache.invalidate(CACHE_NAMESPACE);
  } catch (err) {
    logger.warn(`[catalog] cache invalidation failed: ${(err as Error).message}`);
  }
};

/**
 * Read-through cache that degrades to a DB read when Redis is down. Only
 * Redis failures are swallowed: an error from `produce` (a 404, say) is
 * thrown as-is and is never cached.
 */
const remember = async <T>(key: string, produce: () => Promise<T>): Promise<T> => {
  let hit: T | null = null;
  try {
    hit = await cache.get<T>(key);
  } catch (err) {
    logger.warn(`[catalog] cache read failed: ${(err as Error).message}`);
  }
  if (hit !== null) return hit;

  const value = await produce();
  try {
    await cache.set(key, value, CACHE_TTL_SECONDS);
  } catch (err) {
    logger.warn(`[catalog] cache write failed: ${(err as Error).message}`);
  }
  return value;
};

const loadService = async (id: string): Promise<CareService> => {
  const service = await catalogRepository.findById(id);
  if (!service) throw new NotFoundError("Service");
  return service;
};

const loadCategory = async (id: string): Promise<ServiceCategory> => {
  const category = await catalogRepository.findCategoryById(id);
  if (!category) throw new NotFoundError("Category");
  return category;
};

/** A published service must be complete: families and the matcher depend on every field. */
const assertPublishable = async (service: CareService): Promise<void> => {
  const missing: string[] = [];
  if (!service.name?.trim()) missing.push("name");
  if (!service.description?.trim()) missing.push("description");
  if (!service.basePriceCents || service.basePriceCents <= 0) missing.push("basePriceCents");
  if (!service.requiredSkills?.length) missing.push("requiredSkills");
  const category = await catalogRepository.findCategoryById(String(service.categoryId));
  if (!category) missing.push("categoryId");
  else if (!category.active) missing.push("an active category");

  if (missing.length) {
    throw new UnprocessableError(`Cannot publish: missing ${missing.join(", ")}`);
  }
};

export const catalogService = {
  // ===========================================================================
  // Discovery (public)
  // ===========================================================================

  /**
   * Published services for everyone. Admins may pass `status` to see drafts
   * and archived services; for anyone else `status` is ignored, never honoured.
   */
  list: async (
    query: ListServicesQuery,
    isAdmin: boolean,
  ): Promise<Paginated<CareService>> => {
    const filters: ServiceFilters = {
      status: isAdmin ? query.status : "published",
      q: query.q,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
    };

    if (query.category) {
      const category = await catalogRepository.findCategoryBySlug(query.category);
      if (!category) return buildPage([], 0, query.page, query.limit);
      filters.categoryId = String(category._id);
    }

    const skip = (query.page - 1) * query.limit;
    const [items, total] = await catalogRepository.findPage(filters, skip, query.limit);
    return buildPage(items, total, query.page, query.limit);
  },

  /** The cached public listing. Stores views, not documents, so it survives JSON. */
  listPublic: async (query: ListServicesQuery): Promise<Paginated<CareServiceView>> => {
    const { status: _ignored, ...publicQuery } = query;
    const key = `catalog:list:${JSON.stringify(publicQuery)}`;
    return remember(key, async () => {
      const page = await catalogService.list(publicQuery, false);
      return { ...page, items: page.items.map(serializeCareService) };
    });
  },

  /** One service by slug. Drafts and archived services are 404 to non-admins. */
  getBySlug: async (slug: string, isAdmin: boolean): Promise<CareService> => {
    const service = await catalogRepository.findBySlug(slug);
    if (!service || (!isAdmin && service.status !== "published")) {
      throw new NotFoundError("Service");
    }
    return service;
  },

  getPublicBySlug: async (slug: string): Promise<CareServiceView> =>
    remember(`catalog:service:${slug}`, async () =>
      serializeCareService(await catalogService.getBySlug(slug, false)),
    ),

  /** Active categories with their count of published services. */
  listCategories: async (isAdmin: boolean): Promise<ServiceCategoryView[]> => {
    const produce = async () => {
      const [categories, counts] = await Promise.all([
        catalogRepository.findCategories(!isAdmin),
        catalogRepository.countPublishedByCategory(),
      ]);
      return categories.map((c) => serializeCategory(c, counts.get(String(c._id)) ?? 0));
    };
    return isAdmin ? produce() : remember("catalog:categories", produce);
  },

  /** A category and its published services. Inactive categories are 404 to non-admins. */
  getCategoryBySlug: async (
    slug: string,
    isAdmin: boolean,
  ): Promise<{ category: ServiceCategoryView; services: CareServiceView[] }> => {
    const produce = async () => {
      const category = await catalogRepository.findCategoryBySlug(slug);
      if (!category || (!isAdmin && !category.active)) throw new NotFoundError("Category");
      const [services] = await catalogRepository.findPage(
        { status: "published", categoryId: String(category._id) },
        0,
        100,
      );
      return {
        category: serializeCategory(category, services.length),
        services: services.map(serializeCareService),
      };
    };
    return isAdmin ? produce() : remember(`catalog:category:${slug}`, produce);
  },

  // ===========================================================================
  // Administration
  // ===========================================================================

  getById: loadService,

  /** New services start as drafts: invisible and unbookable until published. */
  create: async (input: CreateServiceInput, actorId: string): Promise<CareService> => {
    await loadCategory(input.categoryId);
    const slug = input.slug ?? slugify(input.name);
    if (!slug) throw new UnprocessableError("Could not derive a slug from the name");

    try {
      const service = await catalogRepository.create({
        ...input,
        slug,
        categoryId: new Types.ObjectId(input.categoryId),
        status: "draft",
        publishedAt: null,
        createdBy: new Types.ObjectId(actorId),
      } as NewCareService);
      await invalidateCache();
      return service;
    } catch (err) {
      if (isDuplicateKey(err)) throw new ConflictError(`A service with slug "${slug}" already exists`);
      throw err;
    }
  },

  /**
   * Edit a service. A price change is appended to history BEFORE the update,
   * so the trail can never miss a change that did land. Existing bookings are
   * never repriced: they captured the price when they were made.
   */
  update: async (
    id: string,
    input: UpdateServiceInput,
    actorId: string,
  ): Promise<CareService> => {
    const current = await loadService(id);

    if (input.slug && input.slug !== current.slug && current.publishedAt) {
      throw new ConflictError("A slug cannot change once the service has been published");
    }
    if (input.categoryId) await loadCategory(input.categoryId);

    const priceChanged =
      input.basePriceCents !== undefined && input.basePriceCents !== current.basePriceCents;

    if (priceChanged) {
      await catalogRepository.appendPriceHistory({
        serviceId: current._id,
        oldPriceCents: current.basePriceCents,
        newPriceCents: input.basePriceCents!,
        changedBy: new Types.ObjectId(actorId),
        effectiveFrom: new Date(),
      });
    }

    const { categoryId, ...rest } = input;
    let updated: CareService | null;
    try {
      updated = await catalogRepository.update(id, {
        ...rest,
        ...(categoryId && { categoryId: new Types.ObjectId(categoryId) }),
      } as Partial<NewCareService>);
    } catch (err) {
      if (isDuplicateKey(err)) throw new ConflictError(`A service with slug "${input.slug}" already exists`);
      throw err;
    }
    if (!updated) throw new NotFoundError("Service");

    await invalidateCache();
    if (priceChanged) {
      await publish("service.price.changed", {
        serviceId: id,
        priceCents: updated.basePriceCents,
      });
    }
    return updated;
  },

  /** draft or archived → published, once the record is complete. */
  publish: async (id: string): Promise<CareService> => {
    const service = await loadService(id);
    if (service.status === "published") return service;
    await assertPublishable(service);

    const updated = await catalogRepository.transition(id, ["draft", "archived"], {
      status: "published",
      publishedAt: service.publishedAt ?? new Date(),
    });
    if (!updated) throw new ConflictError("The service changed state; reload and try again");

    await invalidateCache();
    await publish("service.published", { serviceId: id });
    return updated;
  },

  /** published → draft. Existing bookings keep their captured price. */
  unpublish: async (id: string): Promise<CareService> => {
    await loadService(id);
    const updated = await catalogRepository.transition(id, ["published"], { status: "draft" });
    if (!updated) throw new ConflictError("Only a published service can be unpublished");
    await invalidateCache();
    return updated;
  },

  /** Retire a service. Never a hard delete: bookings and invoices point here. */
  archive: async (id: string): Promise<CareService> => {
    const service = await loadService(id);
    if (service.status === "archived") return service;
    const updated = await catalogRepository.transition(id, ["draft", "published"], {
      status: "archived",
    });
    if (!updated) throw new ConflictError("The service changed state; reload and try again");
    await invalidateCache();
    return updated;
  },

  priceHistory: async (id: string): Promise<PriceHistory[]> => {
    await loadService(id);
    return catalogRepository.findPriceHistory(id);
  },

  createCategory: async (input: CreateCategoryInput): Promise<ServiceCategory> => {
    const slug = input.slug ?? slugify(input.name);
    try {
      const category = await catalogRepository.createCategory({
        ...input,
        slug,
        iconKey: input.iconKey ?? null,
      });
      await invalidateCache();
      return category;
    } catch (err) {
      if (isDuplicateKey(err)) throw new ConflictError(`A category with slug "${slug}" already exists`);
      throw err;
    }
  },

  updateCategory: async (id: string, input: UpdateCategoryInput): Promise<ServiceCategory> => {
    await loadCategory(id);
    try {
      const category = await catalogRepository.updateCategory(id, input);
      if (!category) throw new NotFoundError("Category");
      await invalidateCache();
      return category;
    } catch (err) {
      if (isDuplicateKey(err)) throw new ConflictError(`A category with slug "${input.slug}" already exists`);
      throw err;
    }
  },

  // ===========================================================================
  // For other modules
  // ===========================================================================

  /**
   * booking-service calls this before creating or repricing a booking.
   * Only a published service is bookable; anything else is null.
   */
  getBookable: async (serviceId: string): Promise<BookableService | null> => {
    if (!Types.ObjectId.isValid(serviceId)) return null;
    const service = await catalogRepository.findById(serviceId);
    if (!service || service.status !== "published") return null;
    return {
      id: String(service._id),
      basePriceCents: service.basePriceCents,
      pricingUnit: service.pricingUnit,
      minimumDurationMinutes: service.minimumDurationMinutes,
      requiredSkills: [...(service.requiredSkills ?? [])],
    };
  },
};
