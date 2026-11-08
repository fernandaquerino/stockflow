import { PaginationQueryDto, SortOrder } from './pagination.dto';

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export function toSkipTake({ page, pageSize }: PaginationQueryDto): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function buildPage<T>(
  data: T[],
  total: number,
  { page, pageSize }: PaginationQueryDto,
): Paginated<T> {
  return {
    data,
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

/**
 * Builds a deterministic ORDER BY: the requested field first and the primary key as a
 * tie-breaker, so rows with identical sort values never shuffle between pages.
 */
export function buildOrderBy<F extends string>(
  sortBy: F,
  sortOrder: SortOrder,
): Array<Record<string, SortOrder>> {
  return sortBy === 'id' ? [{ id: sortOrder }] : [{ [sortBy]: sortOrder }, { id: sortOrder }];
}
