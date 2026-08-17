import { z } from "zod";
import type { CancelStayUseCase } from "../../application/use_case/stay/cancel_stay";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

const inputSchema = {
  stay_id: z
    .uuid()
    .describe(
      "ID of the stay to cancel. Must belong to a property administered by the authenticated user. Can be obtained via list_stays."
    ),
};

/**
 * Wires the existing `CancelStayUseCase` (already used by the
 * `DELETE /booking/stay/:stay_id` HTTP route) as a destructive MCP tool.
 * Ownership and state invariants are already validated by the use case and
 * the `Stay` entity — this tool does not duplicate that validation.
 * Cancelling a stay dispatches `StayCanceledEvent`, which reverses the
 * booked revenue in the property's ledger via a Finance handler. There is no
 * corresponding handler that revokes the physical door lock's entrance code
 * — that is a pre-existing gap in the domain, not something this tool
 * introduces, but callers must not be led to believe cancellation revokes
 * physical access.
 */
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
