import { z } from "zod";

export const deletePropertySettingInput = {
  property_id: z
    .uuid("Property ID must be a valid UUID")
    .describe(
      "ID of the property the setting belongs to. Must be a property administered by the authenticated user."
    ),
  id: z
    .uuid("ID must be a valid UUID")
    .describe(
      "ID of the property setting to delete. Must belong to the given property. Can be obtained via list_property_settings."
    ),
} satisfies z.ZodRawShape;
