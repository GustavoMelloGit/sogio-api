import { z } from "zod";
import type { DeletePropertyUseCase } from "../../application/use_case/delete_property";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

const inputSchema = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property to delete. Must be a property administered by the authenticated user."
    ),
};

/**
 * Wires the existing `DeletePropertyUseCase` (already used by the
 * `DELETE /property/:property_id` HTTP route) as a destructive MCP tool
 * (§8.6, R-16). Ownership validation is already handled by the use case via
 * `PropertyOwnershipPolicy` — this tool does not duplicate it. The
 * `description` spells out the cascade explicitly: it is the only form of
 * informed consent the MCP protocol offers today for a tool that can cancel
 * an unbounded number of reservations in a single call.
 */
export function makeDeletePropertyTool(
  useCase: DeletePropertyUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "delete_property",
    description:
      "Deletes a property and cancels every one of its future stays in cascade, reversing their revenue in the property's ledger. Refused if a guest is checked in right now — wait for that stay to end, then retry. This is permanent from the product's point of view: there is no restore, trash, or way to bring the property or its canceled stays back through the API. Returns how many stays were canceled.",
    inputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    handler: async (input, user) => {
      return useCase.execute({ property_id: input.property_id }, user);
    },
  };
}
