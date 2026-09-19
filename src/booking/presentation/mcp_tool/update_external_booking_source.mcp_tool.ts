import { z } from "zod";
import type { UpdateExternalBookingSourceUseCase } from "../../application/use_case/property/update_external_booking_source";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { KNOWN_EXTERNAL_BOOKING_PLATFORMS } from "../../domain/entity/external_booking_source";

const inputSchema = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property the calendar belongs to. Must be a property administered by the authenticated user."
    ),
  id: z
    .uuid()
    .describe(
      "ID of the connected calendar to update. Must belong to the given property. Can be obtained via list_external_booking_sources."
    ),
  platform_name: z
    .string()
    .max(50)
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9 _-]{1,49}$/,
      "Platform name must be 2-50 characters, starting with a letter or digit, using only letters, digits, spaces, underscores or hyphens"
    )
    .describe(
      "New name of the external platform. Known examples: " +
        KNOWN_EXTERNAL_BOOKING_PLATFORMS.join(", ") +
        ". Normalized (trimmed, uppercased, spaces/hyphens collapsed to underscores) before being saved. Omit to leave unchanged."
    )
    .optional(),
  sync_url: z
    .url()
    .max(2048)
    .describe(
      "New public iCal URL exported by the platform. Replace it when the platform rotates the URL and reconciliation stops finding reservations. Omit to leave unchanged."
    )
    .optional(),
};

/**
 * The property a calendar belongs to is not patchable — see
 * `ExternalBookingSource.update()`. Ownership is handled by the use case via
 * `PropertyOwnershipPolicy`.
 */
export function makeUpdateExternalBookingSourceTool(
  useCase: UpdateExternalBookingSourceUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "update_external_booking_source",
    description:
      "Updates an external platform calendar connected to a property: its platform name, its iCal sync URL, or both. The property it belongs to cannot be changed — to move a calendar, delete it and create it on the other property.",
    inputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    handler: async (input, user) =>
      useCase.execute(
        {
          property_id: input.property_id,
          id: input.id,
          platform_name: input.platform_name,
          sync_url: input.sync_url,
        },
        user
      ),
  };
}
