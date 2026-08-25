import {
  paginationFields,
  toPaginationInput,
} from "../../../core/application/dto/pagination";
import type { GetSubscriptionHistoryUseCase } from "../../application/use_case/get_subscription_history";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

export const inputSchema = paginationFields;

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
      return useCase.execute({ pagination: toPaginationInput(input) }, user);
    },
  };
}
