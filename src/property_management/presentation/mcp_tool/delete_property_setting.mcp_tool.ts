import type { DeletePropertySettingUseCase } from "../../application/use_case/delete_property_setting";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { deletePropertySettingInput } from "../schema/delete_property_setting.schema";

/**
 * Wires the existing `DeletePropertySettingUseCase` (already used by the
 * `DELETE /property/:property_id/settings/:id` HTTP route) as a destructive
 * MCP tool. Property ownership validation is already handled by the use case
 * via `PropertyOwnershipPolicy` — this tool does not duplicate it.
 */
export function makeDeletePropertySettingTool(
  useCase: DeletePropertySettingUseCase
): McpToolDefinition<typeof deletePropertySettingInput> {
  return {
    name: "delete_property_setting",
    description:
      "Deletes a property-scoped configuration entry. This is a soft delete: the row is kept, but its value and description are permanently erased and cannot be recovered — this is not a reversible action, there is no undo.",
    inputSchema: deletePropertySettingInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    handler: async (input, user) => {
      await useCase.execute(
        { property_id: input.property_id, id: input.id },
        user
      );

      return { success: true };
    },
  };
}
