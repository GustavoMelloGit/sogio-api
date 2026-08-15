import { z } from "zod";
import type { PropertyManagementDi } from "../../../../property_management/infra/di/property_management_di";
import type { McpToolDefinition } from "../mcp_tool";

const inputSchema = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property the setting belongs to. Must be a property administered by the authenticated user."
    ),
  id: z
    .uuid()
    .describe(
      "ID of the property setting to delete. Must belong to the given property. Can be obtained via list_property_settings."
    ),
};

/**
 * Wires the existing `DeletePropertySettingUseCase` (already used by the
 * `DELETE /property/:property_id/settings/:id` HTTP route) as a destructive
 * MCP tool. Property ownership validation is already handled by the use case
 * via `PropertyOwnershipPolicy` — this tool does not duplicate it.
 */
export function makeDeletePropertySettingTool(
  propertyManagementDi: PropertyManagementDi
): McpToolDefinition<typeof inputSchema> {
  const useCase = propertyManagementDi.makeDeletePropertySettingUseCase();

  return {
    name: "delete_property_setting",
    description:
      "Deletes a property-scoped configuration entry. This is a soft delete: the row is kept, but its value and description are permanently erased and cannot be recovered — this is not a reversible action, there is no undo.",
    inputSchema,
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
