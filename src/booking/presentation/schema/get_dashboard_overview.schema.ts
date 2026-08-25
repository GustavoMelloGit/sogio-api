import { z } from "zod";

export const getDashboardOverviewInput = {
  date: z.iso
    .date()
    .transform(value => new Date(`${value}T00:00:00.000Z`))
    .optional()
    .describe(
      "Reference day for the overview, as a calendar date in YYYY-MM-DD, e.g. 2026-08-24. Defaults to today. Monthly revenue covers the month this day falls in."
    ),
} satisfies z.ZodRawShape;
