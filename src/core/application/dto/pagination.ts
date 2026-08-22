import { z } from "zod";

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
export const MAX_PAGE = 10_000;

/**
 * Parâmetros de entrada para paginação
 */
export const paginationInputSchema = z.object({
  page: z.int().positive().max(MAX_PAGE).default(DEFAULT_PAGE),
  limit: z.int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

export type PaginationInput = z.infer<typeof paginationInputSchema>;

/**
 * Resultado paginado com metadados
 */
export type PaginatedResult<T> = {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
    has_next: boolean;
    has_previous: boolean;
  };
};

/**
 * Calcula os metadados de paginação
 */
export function calculatePaginationMetadata(
  page: number,
  limit: number,
  total: number
): PaginatedResult<never>["pagination"] {
  const totalPages = Math.ceil(total / limit);

  return {
    page,
    limit,
    total,
    total_pages: totalPages,
    has_next: page < totalPages,
    has_previous: page > 1,
  };
}
