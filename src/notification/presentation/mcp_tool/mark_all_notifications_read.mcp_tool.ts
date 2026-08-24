import type { MarkAllNotificationsReadUseCase } from "../../application/use_case/mark_all_notifications_read";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

export function makeMarkAllNotificationsReadTool(
  useCase: MarkAllNotificationsReadUseCase
): McpToolDefinition {
  return {
    name: "mark_all_notifications_read",
    description:
      "Marks every unread notification in the authenticated user's own inbox as read and returns how many were marked. Affects exactly the notifications list_notifications shows. Calling it again returns 0. Prefer mark_notification_read when the user meant a single notification.",
    inputSchema: {},
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    handler: async (_input, user) => useCase.execute({}, user),
  };
}
