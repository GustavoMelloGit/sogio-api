import { toPaginationInput } from "../../../core/application/dto/pagination";
import type { ListPropertySettingsUseCase } from "../../application/use_case/list_property_settings";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { listPropertySettingsInput } from "../schema/list_property_settings.schema";

const inputSchema = listPropertySettingsInput;

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
): McpToolDefinition<typeof listPropertySettingsInput> {
  return {
    name: "list_property_settings",
    description:
      "Lists the configuration entries scoped to a property, paginated. To check whether a given key exists, page through all results (using page/limit and pagination.has_next) before concluding it does not — a single page may not contain every setting.",
    inputSchema: listPropertySettingsInput,
    annotations: {
      readOnlyHint: true,
    },
    handler: async (input, user) => {
      return useCase.execute(
        {
          property_id: input.property_id,
          pagination: toPaginationInput(input),
        },
        user
      );
    },
  };
}
