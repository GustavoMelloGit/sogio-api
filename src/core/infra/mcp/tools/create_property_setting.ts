import { z } from "zod";
import type { PropertyManagementDi } from "../../../../property_management/infra/di/property_management_di";
import {
  boundedJsonValue,
  settingKeySchema,
  settingTypeSchema,
} from "../../../domain/value_object/setting_value";
import type { McpToolDefinition } from "../mcp_tool";

const inputSchema = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property the setting should be created for. Must be a property administered by the authenticated user."
    ),
  key: settingKeySchema.describe(
    "Unique key for this setting within the property. Lowercase letters, digits, underscores, dots and hyphens only. Must not look like a secret/credential name (e.g. token, password, api_key, pin) — this is a generic configuration store, not a secrets manager."
  ),
  value: boundedJsonValue.describe(
    "Value for this setting. Must match the shape implied by `type` (string, number, boolean, or a JSON object)."
  ),
  type: settingTypeSchema.describe(
    `Type of the value. Must be one of: ${settingTypeSchema.options.join(", ")}.`
  ),
  description: z
    .string()
    .max(500)
    .optional()
    .describe("Optional free-text description of the setting."),
};

/**
 * Wires the existing `CreatePropertySettingUseCase` (already used by the
 * `POST /property/:property_id/settings` HTTP route) as a write MCP tool.
 * Property ownership validation and the key-uniqueness/active-setting-limit
 * checks are already handled by the use case — this tool does not duplicate
 * them.
 */
export function makeCreatePropertySettingTool(
  propertyManagementDi: PropertyManagementDi
): McpToolDefinition<typeof inputSchema> {
  const useCase = propertyManagementDi.makeCreatePropertySettingUseCase();

  return {
    name: "create_property_setting",
    description: "Creates a new configuration entry scoped to a property.",
    inputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    handler: async (input, user) => {
      return useCase.execute(
        {
          property_id: input.property_id,
          key: input.key,
          value: input.value,
          type: input.type,
          description: input.description ?? null,
        },
        user
      );
    },
  };
}
