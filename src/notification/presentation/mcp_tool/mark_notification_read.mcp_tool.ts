import { z } from "zod";
import type { MarkNotificationReadUseCase } from "../../application/use_case/mark_notification_read";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

export const inputSchema = {
  notification_id: z
    .uuidv4("Notification ID must be a valid UUID")
    .describe("The notification's id, as returned by list_notifications."),
};

export function makeMarkNotificationReadTool(
  useCase: MarkNotificationReadUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "mark_notification_read",
    description:
      "Marks one of the authenticated user's own delivered notifications as read. The id comes from list_notifications. Marking an already-read notification again is a no-op that returns the same read_at.",
    inputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    handler: async (input, user) =>
      useCase.execute({ notification_id: input.notification_id }, user),
  };
}
