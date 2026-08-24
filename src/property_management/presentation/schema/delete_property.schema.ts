import { z } from "zod";

export const deletePropertyInput = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property to delete. Must be a property administered by the authenticated user."
    ),
} satisfies z.ZodRawShape;
