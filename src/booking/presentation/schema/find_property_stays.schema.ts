import { z } from "zod";
import { paginationFields } from "../../../core/application/dto/pagination";

export const findPropertyStaysInput = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property whose stays should be listed. Must be a property administered by the authenticated user."
    ),
  from: z.iso
    .datetime({ offset: true })
    .transform(value => new Date(value))
    .optional()
    .describe(
      "Only include stays whose check-out is on or after this instant. ISO-8601 date-time with an explicit UTC offset, e.g. 2026-08-07T12:00:00Z or 2026-08-07T12:00:00-03:00."
    ),
  to: z.iso
    .datetime({ offset: true })
    .transform(value => new Date(value))
    .optional()
    .describe(
      "Only include stays whose check-in is on or before this instant. ISO-8601 date-time with an explicit UTC offset, e.g. 2026-08-10T12:00:00Z or 2026-08-10T12:00:00-03:00."
    ),
  ...paginationFields,
} satisfies z.ZodRawShape;
