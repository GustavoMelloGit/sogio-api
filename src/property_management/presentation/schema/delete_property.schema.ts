import { z } from "zod";

export const deletePropertyInput = {
  property_id: z
    .uuid("Property ID must be a valid UUID")
    .describe(
      "ID of the property to delete. Must be a property administered by the authenticated user."
    ),
} satisfies z.ZodRawShape;
