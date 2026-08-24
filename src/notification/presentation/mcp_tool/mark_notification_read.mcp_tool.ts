import type { MarkNotificationReadUseCase } from "../../application/use_case/mark_notification_read";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { markNotificationReadInput } from "../schema/mark_notification_read.schema";

export const inputSchema = markNotificationReadInput;

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
