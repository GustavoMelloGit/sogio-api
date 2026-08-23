import { z } from "zod";
import type { ImportBatchLedgerEntriesUseCase } from "../../application/use_case/import_batch_ledger_entries";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import type { ImportRecordStream } from "../../../core/application/import/source_record";
import {
  ImportRejectedError,
  MAX_MCP_IMPORT_RECORDS,
} from "../../../core/application/import/import_failure";
import { MAX_LEDGER_AMOUNT_IN_CENTS } from "../../domain/entity/ledger_entry";

const recordSchema = z.object({
  property_id: z
    .uuid()
    .describe("ID of the property this movement belongs to."),
  kind: z
    .enum(["expense", "revenue"])
    .describe("Whether this movement is an expense or a revenue."),
  amount: z
    .int()
    .positive()
    .max(MAX_LEDGER_AMOUNT_IN_CENTS)
    .describe(
      "Amount in cents, always positive — the sign is derived from kind."
    ),
  category: z
    .string()
    .min(1)
    .max(100)
    .describe(
      "For kind=expense, must be one of: MANUTENÇÃO, ESTADIA, AQUISIÇÕES, FINANCIAMENTO, GASTOS_FIXOS, OUTROS. For kind=revenue, free text up to 100 characters."
    ),
  description: z
    .string()
    .max(500)
    .optional()
    .describe("Optional free-text description of the movement."),
  occurred_at: z
    .string()
    .max(10)
    .optional()
    .describe(
      "Optional date the movement happened, as YYYY-MM-DD or DD/MM/YYYY. Defaults to now."
    ),
});

type RecordInput = z.infer<typeof recordSchema>;

const inputSchema = {
  records: z
    .array(recordSchema)
    .min(1)
    .max(MAX_MCP_IMPORT_RECORDS)
    .describe(
      `Ledger entries to import in a single batch, up to ${MAX_MCP_IMPORT_RECORDS} records. The batch is accepted or rejected as a whole: a rejected batch writes nothing.`
    ),
};

async function* toImportRecordStream(
  records: RecordInput[]
): ImportRecordStream {
  for (const [index, record] of records.entries()) {
    yield {
      row: index + 1,
      values: {
        property_id: record.property_id,
        kind: record.kind,
        amount: String(record.amount),
        category: record.category,
        description: record.description ?? "",
        occurred_at: record.occurred_at ?? "",
      },
    };
  }
}

export function makeImportLedgerEntriesTool(
  useCase: ImportBatchLedgerEntriesUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "import_ledger_entries",
    description:
      "Imports financial movements (expenses and revenues) for one or more properties in a single batch. The whole batch is accepted or rejected atomically: on rejection, nothing is written and the result lists which records failed and why. This does not deduplicate — resubmitting an already-accepted batch inserts every row again; use delete_ledger_entry to remove duplicates.",
    inputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
    handler: async (input, user) => {
      try {
        return await useCase.execute(
          { records: toImportRecordStream(input.records) },
          user
        );
      } catch (error) {
        if (error instanceof ImportRejectedError) {
          return {
            message: error.message,
            failures: error.report.failures,
            truncated: error.report.truncated,
          };
        }
        throw error;
      }
    },
  };
}
