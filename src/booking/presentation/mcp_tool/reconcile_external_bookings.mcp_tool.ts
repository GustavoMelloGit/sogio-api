import type { ReconcileExternalBookingsUseCase } from "../../application/use_case/property/reconcile_external_bookings";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

export function makeReconcileExternalBookingsTool(
  useCase: ReconcileExternalBookingsUseCase
): McpToolDefinition {
  return {
    name: "reconcile_external_bookings",
    description:
      "Downloads the authenticated user's connected external calendars (Airbnb, Booking) live over HTTP and reports the reservations found there that are not yet registered in Sogio. This call performs live network requests and can take several seconds to respond, depending on how many external calendars are connected. It only REPORTS unreconciled reservations that exist on the external platform — it never creates, updates, or books any stay in Sogio; use book_stay separately to register one found here.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
    handler: async (_input, user) => useCase.execute({ user }),
  };
}
