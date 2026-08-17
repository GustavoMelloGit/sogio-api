import { z } from "zod";
import type { UpdatePropertySettingUseCase } from "../../application/use_case/update_property_setting";
import {
  boundedJsonValue,
  settingTypeSchema,
} from "../../../core/domain/value_object/setting_value";
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
      "ID of the property setting to update. Must belong to the given property. Can be obtained via list_property_settings. The setting's key is immutable and cannot be changed."
    ),
  value: boundedJsonValue
    .optional()
    .describe(
      "New value for this setting. Must match the shape implied by `type` (the new one if provided, otherwise the existing one). Omit to leave the value unchanged."
    ),
  type: settingTypeSchema
    .optional()
    .describe(
      `New type for the value. Must be one of: ${settingTypeSchema.options.join(", ")}. Omit to leave the type unchanged.`
    ),
  description: z
    .string()
    .max(500)
    .nullable()
    .optional()
    .describe(
      "New free-text description. Pass null to clear it, or omit to leave it unchanged."
    ),
};

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
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "update_property_setting",
    description:
      "Partially updates a property-scoped configuration entry. The key is immutable.",
    inputSchema,
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
