import { z } from "zod";
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
  MAX_PAGE,
} from "../../../core/application/dto/pagination";
import type { GetSubscriptionHistoryUseCase } from "../../application/use_case/get_subscription_history";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

export const inputSchema = {
  page: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PAGE)
    .default(DEFAULT_PAGE)
    .describe("Page number to retrieve, starting at 1."),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(
      `Number of subscription history entries per page, up to ${MAX_LIMIT}.`
    ),
};

export function makeGetSubscriptionHistoryTool(
  useCase: GetSubscriptionHistoryUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "get_subscription_history",
    description:
      "Returns a paginated, append-only timeline of everything that happened to the authenticated user's own subscription — plan changes, payment failures, cancellations and renewals — most recent first.",
    inputSchema,
    annotations: {
      readOnlyHint: true,
    },
    handler: async (input, user) => {
      return useCase.execute(
        { pagination: { page: input.page, limit: input.limit } },
        user
      );
    },
  };
}
