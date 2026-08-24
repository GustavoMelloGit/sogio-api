import { z } from "zod";
import type { RecordRevenueUseCase } from "../../application/use_case/record_revenue";
import { MAX_LEDGER_AMOUNT_IN_CENTS } from "../../domain/entity/ledger_entry";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

export const inputSchema = {
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
};

export function makeRecordRevenueTool(
  useCase: RecordRevenueUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "record_revenue",
    description:
      "Records a financial revenue entry for a property. Revenue from a booked stay is already recorded automatically, so use this only for money that did not come from a stay booked in Sogio.",
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
