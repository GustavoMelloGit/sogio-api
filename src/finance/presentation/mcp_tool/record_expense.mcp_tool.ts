import type { RecordExpenseUseCase } from "../../application/use_case/record_expense";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { recordExpenseInput } from "../schema/record_expense.schema";

export const inputSchema = recordExpenseInput;

/**
 * Wires the existing `RecordExpenseUseCase` (already used by the
 * `/finance/:property_id/expense` HTTP route) as a write MCP tool. Property
 * ownership and category validation are already handled by the use case and
 * the `LedgerEntry` entity respectively.
 */
export function makeRecordExpenseTool(
  useCase: RecordExpenseUseCase
): McpToolDefinition<typeof inputSchema> {
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
