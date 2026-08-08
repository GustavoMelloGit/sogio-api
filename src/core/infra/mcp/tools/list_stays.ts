import { z } from "zod";
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
} from "../../../application/dto/pagination";
import type { StayDi } from "../../../../booking/infra/di/stay_di";
import type { McpToolDefinition } from "../mcp_tool";

const inputSchema = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property whose stays should be listed. Must be a property administered by the authenticated user."
    ),
  from: z.coerce
    .date()
    .optional()
    .describe(
      "Only include stays whose check-out is on or after this instant. ISO-8601 date-time string (e.g. 2026-08-07T12:00:00Z)."
    ),
  to: z.coerce
    .date()
    .optional()
    .describe(
      "Only include stays whose check-in is on or before this instant. ISO-8601 date-time string (e.g. 2026-08-10T12:00:00Z)."
    ),
  page: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_PAGE)
    .describe("Page number to retrieve, starting at 1."),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(`Number of stays per page, up to ${MAX_LIMIT}.`),
};

/**
 * Wires the existing `FindPropertyStaysUseCase` (already used by the
 * `/booking/property/:property_id/stays` HTTP route) as a read-only MCP
 * tool. Property ownership validation is already handled by the use case
 * itself, which throws `ResourceNotFoundError` when the property does not
 * belong to the resolved user.
 */
export function makeListStaysTool(
  stayDi: StayDi
): McpToolDefinition<typeof inputSchema> {
  const useCase = stayDi.makeFindPropertyStaysUseCase();

  return {
    name: "list_stays",
    description: "Lists the stays booked for a property, paginated.",
    inputSchema,
    annotations: {
      readOnlyHint: true,
    },
    handler: async (input, user) =>
      useCase.execute({
        property_id: input.property_id,
        user_id: user.id,
        pagination: { page: input.page, limit: input.limit },
        filters: { from: input.from, to: input.to },
      }),
  };
}
