import { z } from "zod";
import { MAX_LEDGER_AMOUNT_IN_CENTS } from "../../domain/entity/ledger_entry";

export const recordRevenueInput = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property the revenue should be recorded against. Must be a property administered by the authenticated user."
    ),
  amount: z
    .int()
    .positive()
    .max(MAX_LEDGER_AMOUNT_IN_CENTS)
    .describe(
      "Revenue amount in cents, e.g. 250000 for R$ 2.500,00. Must be a positive integer."
    ),
  category: z
    .string()
    .min(1)
    .max(50)
    .describe(
      "Free-text revenue category, e.g. ESTADIA. Unlike an expense, revenue categories are not a fixed vocabulary."
    ),
  description: z
    .string()
    .max(500)
    .optional()
    .describe("Optional free-text description of the revenue."),
} satisfies z.ZodRawShape;
