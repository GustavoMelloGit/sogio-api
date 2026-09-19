import { z } from "zod";
import type { DeleteExternalBookingSourceUseCase } from "../../application/use_case/property/delete_external_booking_source";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

const inputSchema = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property the calendar belongs to. Must be a property administered by the authenticated user."
    ),
  id: z
    .uuid()
    .describe(
      "ID of the connected calendar to disconnect. Must belong to the given property. Can be obtained via list_external_booking_sources."
    ),
};

/**
 * Ownership is handled by the use case via `PropertyOwnershipPolicy` — this
 * tool does not duplicate it.
 */
export function makeDeleteExternalBookingSourceTool(
  useCase: DeleteExternalBookingSourceUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "delete_external_booking_source",
    description:
      "Disconnects an external platform calendar from a property. Reconciliation stops reading that feed immediately, so reservations that exist only on that platform will no longer be reported. This is a soft delete and there is no undo tool: reconnecting means registering the calendar again with its sync URL.",
    inputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    handler: async (input, user) => {
      await useCase.execute(
        { property_id: input.property_id, id: input.id },
        user
      );

      return { success: true };
    },
  };
}
