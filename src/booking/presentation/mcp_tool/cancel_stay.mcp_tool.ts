import type { CancelStayUseCase } from "../../application/use_case/stay/cancel_stay";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { cancelStayInput } from "../schema/cancel_stay.schema";

const inputSchema = cancelStayInput;

export function makeCancelStayTool(
  useCase: CancelStayUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "cancel_stay",
    description:
      "Cancels a booked stay and reverses its revenue in the property's ledger. This is a destructive, irreversible action (soft-delete; there is no uncancel). Cancelling does not revoke the stay's physical door lock entrance code — that must be handled separately.",
    inputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    handler: async (input, user) => {
      return useCase.execute({ stay_id: input.stay_id }, user);
    },
  };
}
