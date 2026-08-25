import type { CreatePropertySettingUseCase } from "../../application/use_case/create_property_setting";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { createPropertySettingInput } from "../schema/create_property_setting.schema";

/**
 * Wires the existing `CreatePropertySettingUseCase` (already used by the
 * `POST /property/:property_id/settings` HTTP route) as a write MCP tool.
 * Property ownership validation and the key-uniqueness/active-setting-limit
 * checks are already handled by the use case — this tool does not duplicate
 * them.
 */
export function makeCreatePropertySettingTool(
  useCase: CreatePropertySettingUseCase
): McpToolDefinition<typeof createPropertySettingInput> {
  return {
    name: "create_property_setting",
    description: "Creates a new configuration entry scoped to a property.",
    inputSchema: createPropertySettingInput,
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
