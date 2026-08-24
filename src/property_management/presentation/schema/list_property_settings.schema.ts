import { z } from "zod";
import { paginationFields } from "../../../core/application/dto/pagination";

export const listPropertySettingsInput = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property whose settings should be listed. Must be a property administered by the authenticated user."
    ),
  ...paginationFields,
} satisfies z.ZodRawShape;
