import { z } from "zod";
import { MAX_LEDGER_AMOUNT_IN_CENTS } from "../../domain/entity/ledger_entry";

export const recordRevenueInput = {
  property_id: z
    .uuid("Property ID must be a valid UUID")
    .describe(
      "ID of the property the revenue should be recorded against. Must be a property administered by the authenticated user."
    ),
  amount: z
    .int()
    .positive("Amount must be greater than 0")
    .max(
      MAX_LEDGER_AMOUNT_IN_CENTS,
      `Amount must be at most ${MAX_LEDGER_AMOUNT_IN_CENTS} cents`
    )
    .describe(
      "Revenue amount in cents, e.g. 250000 for R$ 2.500,00. Must be a positive integer."
    ),
  category: z
    .string()
    .min(1, "Category is required")
    .max(50, "Category must be at most 50 characters")
    .describe(
      "Free-text revenue category, e.g. ESTADIA. Unlike an expense, revenue categories are not a fixed vocabulary."
    ),
  description: z
    .string()
    .max(500, "Description must be at most 500 characters")
    .optional()
    .describe("Optional free-text description of the revenue."),
} satisfies z.ZodRawShape;
