import { z } from "zod";
import {
  expenseCategorySchema,
  MAX_LEDGER_AMOUNT_IN_CENTS,
} from "../../domain/entity/ledger_entry";

export const recordExpenseInput = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property the expense should be recorded against. Must be a property administered by the authenticated user."
    ),
  amount: z
    .int()
    .positive()
    .max(MAX_LEDGER_AMOUNT_IN_CENTS)
    .describe(
      "Expense amount in cents, e.g. 1050 for R$ 10,50. Must be a positive integer."
    ),
  category: expenseCategorySchema.describe(
    `Expense category. Must be one of: ${expenseCategorySchema.options.join(", ")}.`
  ),
  description: z
    .string()
    .max(500)
    .optional()
    .describe("Optional free-text description of the expense."),
} satisfies z.ZodRawShape;
