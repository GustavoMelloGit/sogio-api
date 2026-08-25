import type { UpdatePropertySettingUseCase } from "../../application/use_case/update_property_setting";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { updatePropertySettingInput } from "../schema/update_property_setting.schema";

/**
 * Wires the existing `UpdatePropertySettingUseCase` (already used by the
 * `PUT /property/:property_id/settings/:id` HTTP route) as a write MCP tool.
 * Property ownership validation is already handled by the use case via
 * `PropertyOwnershipPolicy` — this tool does not duplicate it. Applying the
 * same value again produces the same resulting state, so this tool is
 * idempotent.
 */
export function makeUpdatePropertySettingTool(
  useCase: UpdatePropertySettingUseCase
): McpToolDefinition<typeof updatePropertySettingInput> {
  return {
    name: "update_property_setting",
    description:
      "Partially updates a property-scoped configuration entry. The key is immutable.",
    inputSchema: updatePropertySettingInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    handler: async (input, user) => {
      return useCase.execute(
        {
          property_id: input.property_id,
          id: input.id,
          value: input.value,
          type: input.type,
          description: input.description,
        },
        user
      );
    },
  };
}
