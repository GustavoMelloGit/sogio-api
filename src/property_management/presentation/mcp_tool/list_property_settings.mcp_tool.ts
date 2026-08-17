import { z } from "zod";
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
} from "../../../core/application/dto/pagination";
import type { ListPropertySettingsUseCase } from "../../application/use_case/list_property_settings";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

const inputSchema = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property whose settings should be listed. Must be a property administered by the authenticated user."
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
    .describe(`Number of settings per page, up to ${MAX_LIMIT}.`),
};

/**
 * Wires the existing `ListPropertySettingsUseCase` (already used by the
 * `GET /property/:property_id/settings` HTTP route) as a read-only MCP tool.
 * Property ownership validation is already handled by the use case via
 * `PropertyOwnershipPolicy` — this tool does not duplicate it.
 *
 * The result is paginated (20 per page by default, 100 max). Before
 * concluding a given key does not exist for a property, page through the
 * full result set using `page`/`limit` and check `pagination.has_next` —
 * stopping at the first page and reporting a key as absent is a false
 * negative if the property has more than one page of settings.
 */
export function makeListPropertySettingsTool(
  useCase: ListPropertySettingsUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "list_property_settings",
    description:
      "Lists the configuration entries scoped to a property, paginated. To check whether a given key exists, page through all results (using page/limit and pagination.has_next) before concluding it does not — a single page may not contain every setting.",
    inputSchema,
    annotations: {
      readOnlyHint: true,
    },
    handler: async (input, user) => {
      return useCase.execute(
        {
          property_id: input.property_id,
          pagination: { page: input.page, limit: input.limit },
        },
        user
      );
    },
  };
}
