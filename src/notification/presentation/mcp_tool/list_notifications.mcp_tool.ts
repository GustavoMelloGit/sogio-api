import type { ListNotificationsUseCase } from "../../application/use_case/list_notifications";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import {
  paginationFields,
  toPaginationInput,
} from "../../../core/application/dto/pagination";

export const inputSchema = paginationFields;

export function makeListNotificationsTool(
  useCase: ListNotificationsUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "list_notifications",
    description:
      "Lists the authenticated user's own notification inbox, paginated, newest first. Only delivered notifications appear — one still pending or one the platform gave up retrying never shows up. title and body come already rendered in the user's own locale and time zone. unread_count covers the whole inbox, not just this page. Use the returned id with mark_notification_read.",
    inputSchema,
    annotations: {
      readOnlyHint: true,
    },
    handler: async (input, user) =>
      useCase.execute({ pagination: toPaginationInput(input) }, user),
  };
}
