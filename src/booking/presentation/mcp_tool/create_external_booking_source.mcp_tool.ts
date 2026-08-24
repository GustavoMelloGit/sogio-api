import type { CreateExternalBookingSourceUseCase } from "../../application/use_case/property/create_external_booking_source";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { createExternalBookingSourceInput } from "../schema/create_external_booking_source.schema";

export const inputSchema = createExternalBookingSourceInput;

export function makeCreateExternalBookingSourceTool(
  useCase: CreateExternalBookingSourceUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "create_external_booking_source",
    description:
      "Registers an external platform calendar (any provider that publishes an iCal feed, e.g. Airbnb, Booking, Vrbo) for a property, so its reservations can be reconciled later. Registering the calendar does not import anything by itself.",
    inputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
    handler: async (input, user) => {
      return useCase.execute({
        property_id: input.property_id,
        platform_name: input.platform_name,
        sync_url: input.sync_url,
        user_id: user.id,
      });
    },
  };
}
