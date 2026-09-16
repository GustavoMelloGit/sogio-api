import type { GetSubscriptionStatusUseCase } from "../../application/use_case/get_subscription_status";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

export function makeGetSubscriptionStatusTool(
  useCase: GetSubscriptionStatusUseCase
): McpToolDefinition {
  return {
    name: "get_subscription_status",
    description:
      "Returns the authenticated user's current subscription status: whether they have platform access, the subscription status, the effective plan, and the capabilities that plan grants — access flags and numeric limits (e.g. max_properties). If access is blocked, includes why. Use this to find out what the current plan covers and what a higher plan would unlock, especially right after another tool call fails because it requires a capability the current plan does not have.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
    },
    handler: async (_input, user) => useCase.execute({}, user),
  };
}
