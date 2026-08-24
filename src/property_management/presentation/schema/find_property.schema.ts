import { z } from "zod";

export const findPropertyInput = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property to fetch. Must be a property administered by the authenticated user. Can be obtained via list_properties."
    ),
} satisfies z.ZodRawShape;
