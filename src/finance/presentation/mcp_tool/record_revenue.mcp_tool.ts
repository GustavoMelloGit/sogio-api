import type { RecordRevenueUseCase } from "../../application/use_case/record_revenue";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { recordRevenueInput } from "../schema/record_revenue.schema";

export const inputSchema = recordRevenueInput;

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
