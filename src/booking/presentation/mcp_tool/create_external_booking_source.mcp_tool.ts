import { z } from "zod";
import type { CreateExternalBookingSourceUseCase } from "../../application/use_case/property/create_external_booking_source";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { KNOWN_EXTERNAL_BOOKING_PLATFORMS } from "../../domain/entity/external_booking_source";

export const inputSchema = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property the calendar belongs to. Must be a property administered by the authenticated user."
    ),
  platform_name: z
    .string()
    .max(50)
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9 _-]{1,49}$/,
      "Platform name must be 2-50 characters, starting with a letter or digit, using only letters, digits, spaces, underscores or hyphens"
    )
    .describe(
      "Name of the external platform the calendar comes from. Any provider that publishes an iCal feed works, not just a fixed list. Known examples: " +
        KNOWN_EXTERNAL_BOOKING_PLATFORMS.join(", ") +
        ". Stored as an uppercase slug: the value is normalized (trimmed, uppercased, spaces/hyphens collapsed to underscores) before being saved."
    ),
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
