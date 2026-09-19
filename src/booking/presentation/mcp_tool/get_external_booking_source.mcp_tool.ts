import { z } from "zod";
import type { GetExternalBookingSourceUseCase } from "../../application/use_case/property/get_external_booking_source";
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
      "ID of the connected calendar to fetch. Must belong to the given property. Can be obtained via list_external_booking_sources."
    ),
};

export function makeGetExternalBookingSourceTool(
  useCase: GetExternalBookingSourceUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "get_external_booking_source",
    description:
      "Fetches a single external platform calendar connected to a property, including its iCal sync URL and when it was connected.",
    inputSchema,
    annotations: {
      readOnlyHint: true,
    },
    handler: async (input, user) =>
      useCase.execute({ property_id: input.property_id, id: input.id }, user),
  };
}
