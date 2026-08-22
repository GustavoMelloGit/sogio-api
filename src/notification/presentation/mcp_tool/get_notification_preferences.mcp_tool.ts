import type { GetNotificationPreferencesUseCase } from "../../application/use_case/get_notification_preferences";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

export function makeGetNotificationPreferencesTool(
  useCase: GetNotificationPreferencesUseCase
): McpToolDefinition {
  return {
    name: "get_notification_preferences",
    description:
      "Lists every notification the platform can send to the authenticated user, the channels it uses (currently email) and whether each one is enabled. A preference never configured reports its default. Types marked as not optional are always delivered and cannot be turned off. Use this before trying to change a preference, to find out which types exist.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
    },
    handler: async (_input, user) => useCase.execute(undefined, user),
  };
}
