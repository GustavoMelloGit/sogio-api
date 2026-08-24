import type { ListPlansUseCase } from "../../application/use_case/list_plans";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

export function makeListPlansTool(
  useCase: ListPlansUseCase
): McpToolDefinition {
  return {
    name: "list_plans",
    description:
      "Lists the plans on offer, with the capabilities each one unlocks. Use it after a call is denied for lacking a capability, to tell the user which plan covers it. Prices are in cents. To read the plan the user is on today, use get_subscription_status instead.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
    },
    handler: async () => {
      const plans = await useCase.execute();

      return plans.map(
        ({ external_price_reference: _external, ...plan }) => plan
      );
    },
  };
}
