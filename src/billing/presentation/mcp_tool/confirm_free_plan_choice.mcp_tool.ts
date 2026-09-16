import type { ConfirmFreePlanChoiceUseCase } from "../../application/use_case/confirm_free_plan_choice";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

export function makeConfirmFreePlanChoiceTool(
  useCase: ConfirmFreePlanChoiceUseCase
): McpToolDefinition {
  return {
    name: "confirm_free_plan_choice",
    description:
      "Records that the authenticated user chose to stay on the Free plan as their initial plan, which clears needs_plan_choice in get_subscription_status. Only meaningful while needs_plan_choice is true. It never changes, cancels or downgrades a plan: if the initial choice was already made — including a paid subscription — it does nothing and still succeeds, so never use it to move a paying user back to Free (that is done by the user in the billing portal).",
    inputSchema: {},
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    handler: async (_input, user) => {
      await useCase.execute({}, user);

      return { success: true };
    },
  };
}
