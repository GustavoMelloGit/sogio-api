import { z } from "zod";
import type { DeleteLedgerEntryUseCase } from "../../application/use_case/delete_ledger_entry";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

const inputSchema = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property the ledger entry belongs to. Must be a property administered by the authenticated user."
    ),
  entry_id: z
    .uuid()
    .describe(
      "ID of the ledger entry (financial movement) to delete. Can be obtained from the property's financial movements listing."
    ),
};

export function makeDeleteLedgerEntryTool(
  useCase: DeleteLedgerEntryUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "delete_ledger_entry",
    description:
      "Deletes a financial movement (expense or revenue). This is a soft delete for remediation — e.g. a row created by a duplicated import — not a reversal: the row is kept for audit but stops counting toward the property's balance. A stay's revenue reverting on cancellation is a separate, automatic mechanism and is never undone through this tool. This is not reversible: there is no undo.",
    inputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    handler: async (input, user) => {
      await useCase.execute(
        { property_id: input.property_id, entry_id: input.entry_id },
        user
      );

      return { success: true };
    },
  };
}
