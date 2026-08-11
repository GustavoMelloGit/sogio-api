import { z } from "zod";
import type { FinanceDi } from "../../../../finance/infra/di/finance_di";
import { expenseCategorySchema } from "../../../../finance/domain/entity/ledger_entry";
import type { McpToolDefinition } from "../mcp_tool";

export const inputSchema = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property the expense should be recorded against. Must be a property administered by the authenticated user."
    ),
  amount: z
    .int()
    .positive()
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
};

/**
 * Wires the existing `RecordExpenseUseCase` (already used by the
 * `/finance/:property_id/expense` HTTP route) as a write MCP tool. Property
 * ownership and category validation are already handled by the use case and
 * the `LedgerEntry` entity respectively.
 */
export function makeRecordExpenseTool(
  financeDi: FinanceDi
): McpToolDefinition<typeof inputSchema> {
  const useCase = financeDi.makeRecordExpenseUseCase();

  return {
    name: "record_expense",
    description: "Records a financial expense for a property.",
    inputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
    handler: async (input, user) => {
      await useCase.execute(
        {
          property_id: input.property_id,
          amount: input.amount,
          category: input.category,
          description: input.description ?? null,
        },
        user
      );

      return { success: true };
    },
  };
}
