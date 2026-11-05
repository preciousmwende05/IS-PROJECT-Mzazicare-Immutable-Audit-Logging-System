import type { Paginated } from "@/shared/types";

export const MAX_LIMIT = 100;

export const parsePagination = (query: { page?: unknown; limit?: unknown }) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

export const buildPage = <T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): Paginated<T> => ({
  items,
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});
