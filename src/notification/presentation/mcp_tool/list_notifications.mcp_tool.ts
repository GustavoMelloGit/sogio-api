import { z } from "zod";
import type { ListNotificationsUseCase } from "../../application/use_case/list_notifications";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
  MAX_PAGE,
} from "../../../core/application/dto/pagination";

export const inputSchema = {
  page: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PAGE)
    .default(DEFAULT_PAGE)
    .describe("Page number, starting at 1."),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(`Notifications per page, up to ${MAX_LIMIT}.`),
};

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
      useCase.execute(
        { pagination: { page: input.page, limit: input.limit } },
        user
      ),
  };
}
