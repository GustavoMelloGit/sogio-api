import { z } from "zod";
import { paginationFields } from "../../../core/application/dto/pagination";

export const findPropertyFinancialMovementsInput = {
  property_id: z
    .uuid("Property ID must be a valid UUID")
    .describe(
      "ID of the property whose financial movements should be listed. Must be a property administered by the authenticated user."
    ),
  start_date: z.iso
    .datetime({ offset: true })
    .transform(value => new Date(value))
    .optional()
    .describe(
      "Only include movements recorded on or after this instant. ISO-8601 date-time with an explicit UTC offset, e.g. 2026-08-01T00:00:00-03:00."
    ),
  end_date: z.iso
    .datetime({ offset: true })
    .transform(value => new Date(value))
    .optional()
    .describe(
      "Only include movements recorded on or before this instant. ISO-8601 date-time with an explicit UTC offset, e.g. 2026-08-31T23:59:59-03:00."
    ),
  ...paginationFields,
} satisfies z.ZodRawShape;
