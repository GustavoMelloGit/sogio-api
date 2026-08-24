import type { UpdateNotificationPreferencesUseCase } from "../../application/use_case/update_notification_preferences";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { updateNotificationPreferencesInput } from "../schema/update_notification_preferences.schema";

export const inputSchema = updateNotificationPreferencesInput;

export function makeUpdateNotificationPreferencesTool(
  useCase: UpdateNotificationPreferencesUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "update_notification_preferences",
    description:
      "Turns a notification type on or off for a channel, for the authenticated user. Call get_notification_preferences first to learn the valid type and channel values — an unknown one, or a type the platform always delivers, is rejected.",
    inputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
    handler: async (input, user) =>
      useCase.execute(
        {
          type: input.type,
          channel: input.channel,
          enabled: input.enabled,
        },
        user
      ),
  };
}
