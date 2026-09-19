import { z } from "zod";
import type { ListExternalBookingSourcesUseCase } from "../../application/use_case/property/list_external_booking_sources";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

const inputSchema = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property whose connected calendars should be listed. Must be a property administered by the authenticated user."
    ),
};

/**
 * The read side of `create_external_booking_source`, which shipped without
 * one. Without this tool an assistant asked "is a calendar configured?" has
 * nothing to call, and in practice reaches for the nearest-looking tool —
 * `list_property_settings`, a different table — and reports "no calendar
 * configured" for a property that has a live feed.
 *
 * Deliberately not paginated, so a caller never has to page before
 * concluding a platform is absent. Ownership is handled by the use case via
 * `PropertyOwnershipPolicy` — this tool does not duplicate it.
 */
export function makeListExternalBookingSourcesTool(
  useCase: ListExternalBookingSourcesUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "list_external_booking_sources",
    description:
      "Lists every external platform calendar (Airbnb, Booking, Vrbo, …) connected to a property, in full — the result is not paginated, so an empty list means no calendar is connected. Use this to check whether a property syncs with an external platform before saying it does not. Reading this list performs no network request and does not fetch reservations; use reconcile_external_bookings for that.",
    inputSchema,
    annotations: {
      readOnlyHint: true,
    },
    handler: async (input, user) =>
      useCase.execute({ property_id: input.property_id }, user),
  };
}
