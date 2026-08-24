import { z } from "zod";

export const cancelStayInput = {
  stay_id: z
    .uuid()
    .describe(
      "ID of the stay to cancel. Must belong to a property administered by the authenticated user. Can be obtained via list_stays."
    ),
} satisfies z.ZodRawShape;
