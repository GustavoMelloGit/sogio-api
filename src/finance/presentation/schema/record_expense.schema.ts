import { z } from "zod";
import {
  expenseCategorySchema,
  MAX_LEDGER_AMOUNT_IN_CENTS,
} from "../../domain/entity/ledger_entry";

export const recordExpenseInput = {
  property_id: z
    .uuid("Property ID must be a valid UUID")
    .describe(
      "ID of the property the expense should be recorded against. Must be a property administered by the authenticated user."
    ),
  amount: z
    .int()
    .positive("Amount must be greater than 0")
    .max(
      MAX_LEDGER_AMOUNT_IN_CENTS,
      `Amount must be at most ${MAX_LEDGER_AMOUNT_IN_CENTS} cents`
    )
    .describe(
      "Expense amount in cents, e.g. 1050 for R$ 10,50. Must be a positive integer."
    ),
  category: expenseCategorySchema.describe(
    `Expense category. Must be one of: ${expenseCategorySchema.options.join(", ")}.`
  ),
  description: z
    .string()
    .max(500, "Description must be at most 500 characters")
    .optional()
    .describe("Optional free-text description of the expense."),
} satisfies z.ZodRawShape;
