import { z } from "zod";
import type { CreateExternalBookingSourceUseCase } from "../../application/use_case/property/create_external_booking_source";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

export const inputSchema = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property the calendar belongs to. Must be a property administered by the authenticated user."
    ),
  platform_name: z
    .enum(["AIRBNB", "BOOKING"])
    .describe("External platform the calendar comes from."),
  sync_url: z
    .url()
    .max(2048)
    .describe(
      "Public iCal URL exported by the platform, e.g. https://www.airbnb.com/calendar/ical/12345.ics. Copy it from the platform's calendar export screen."
    ),
};

export function makeCreateExternalBookingSourceTool(
  useCase: CreateExternalBookingSourceUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "create_external_booking_source",
    description:
      "Registers an external platform calendar (Airbnb or Booking) for a property, so its reservations can be reconciled later. Registering the calendar does not import anything by itself.",
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
