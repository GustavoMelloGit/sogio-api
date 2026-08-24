import { z } from "zod";
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
  MAX_PAGE,
} from "../../../core/application/dto/pagination";
import type { FindPropertyFinancialMovementsUseCase } from "../../application/use_case/find_property_financial_movements";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

const inputSchema = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property whose financial movements should be listed. Must be a property administered by the authenticated user."
    ),
  start_date: z.iso
    .datetime({ offset: true })
    .transform(value => new Date(value))
    .optional()
    .describe(
      "Only include movements recorded on or after this instant. ISO-8601 date-time with an explicit UTC offset, e.g. 2026-08-01T00:00:00-03:00."
    ),
  end_date: z.iso
    .datetime({ offset: true })
    .transform(value => new Date(value))
    .optional()
    .describe(
      "Only include movements recorded on or before this instant. ISO-8601 date-time with an explicit UTC offset, e.g. 2026-08-31T23:59:59-03:00."
    ),
  page: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PAGE)
    .default(DEFAULT_PAGE)
    .describe("Page number to retrieve, starting at 1."),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(`Number of movements per page, up to ${MAX_LIMIT}.`),
};

export function makeListFinancialMovementsTool(
  useCase: FindPropertyFinancialMovementsUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "list_financial_movements",
    description:
      "Lists the ledger entries of a property, paginated and newest first. Amounts are in cents, and a negative amount is an expense while a positive one is revenue. Before totalling a period or concluding an entry is absent, page through the whole result set using page/limit and pagination.has_next — a single page rarely covers a full month.",
    inputSchema,
    annotations: {
      readOnlyHint: true,
    },
    handler: async (input, user) => {
      return useCase.execute(
        {
          propertyId: input.property_id,
          pagination: { page: input.page, limit: input.limit },
          dateFilter: {
            start_date: input.start_date,
            end_date: input.end_date,
          },
        },
        user
      );
    },
  };
}
