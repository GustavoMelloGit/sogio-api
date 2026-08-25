import type { GetPropertySettingUseCase } from "../../application/use_case/get_property_setting";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { getPropertySettingInput } from "../schema/get_property_setting.schema";

/**
 * Wires the existing `GetPropertySettingUseCase` (already used by the
 * `GET /property/:property_id/settings/:id` HTTP route) as a read-only MCP
 * tool. Property ownership validation is already handled by the use case via
 * `PropertyOwnershipPolicy` — this tool does not duplicate it.
 */
export function makeGetPropertySettingTool(
  useCase: GetPropertySettingUseCase
): McpToolDefinition<typeof getPropertySettingInput> {
  return {
    name: "get_property_setting",
    description:
      "Fetches a single configuration entry scoped to a property by its ID.",
    inputSchema: getPropertySettingInput,
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
