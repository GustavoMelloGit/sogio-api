import { z } from "zod";

export const getStayInput = {
  stay_id: z
    .uuid()
    .describe(
      "ID of the stay to read. Must belong to a property administered by the authenticated user."
    ),
} satisfies z.ZodRawShape;
