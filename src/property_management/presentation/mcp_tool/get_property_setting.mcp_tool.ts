import { z } from "zod";
import type { GetPropertySettingUseCase } from "../../application/use_case/get_property_setting";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

const inputSchema = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property the setting belongs to. Must be a property administered by the authenticated user."
    ),
  id: z
    .uuid()
    .describe(
      "ID of the property setting to fetch. Must belong to the given property. Can be obtained via list_property_settings."
    ),
};

/**
 * Wires the existing `GetPropertySettingUseCase` (already used by the
 * `GET /property/:property_id/settings/:id` HTTP route) as a read-only MCP
 * tool. Property ownership validation is already handled by the use case via
 * `PropertyOwnershipPolicy` — this tool does not duplicate it.
 */
export function makeGetPropertySettingTool(
  useCase: GetPropertySettingUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "get_property_setting",
    description:
      "Fetches a single configuration entry scoped to a property by its ID.",
    inputSchema,
    annotations: {
      readOnlyHint: true,
    },
    handler: async (input, user) => {
      return useCase.execute(
        { property_id: input.property_id, id: input.id },
        user
      );
    },
  };
}
