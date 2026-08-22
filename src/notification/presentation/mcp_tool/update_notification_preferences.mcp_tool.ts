import { z } from "zod";
import { NOTIFICATION_CHANNELS } from "../../domain/notification_type/notification_type_registry";
import type { UpdateNotificationPreferencesUseCase } from "../../application/use_case/update_notification_preferences";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

export const inputSchema = {
  type: z
    .string()
    .min(1)
    .max(100)
    .describe(
      "Notification type key, exactly as returned by get_notification_preferences."
    ),
  channel: z
    .enum(NOTIFICATION_CHANNELS)
    .describe(
      `Delivery channel for this preference. One of: ${NOTIFICATION_CHANNELS.join(", ")}.`
    ),
  enabled: z
    .boolean()
    .describe("Whether this notification should be delivered on this channel."),
};

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
