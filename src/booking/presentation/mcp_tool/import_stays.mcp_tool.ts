import { z } from "zod";
import {
  stayImportRecordSchema,
  type ImportBatchStaysUseCase,
} from "../../application/use_case/import_batch_stays";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { MAX_STAY_PRICE_IN_CENTS } from "../../domain/entity/stay";
import { MAX_PROPERTY_CAPACITY } from "../../../property_management/domain/entity/property";
import type { ImportRecordStream } from "../../../core/application/import/source_record";
import {
  ImportRejectedError,
  MAX_MCP_IMPORT_RECORDS,
} from "../../../core/application/import/import_failure";

const recordInputSchema = stayImportRecordSchema
  .omit({ entrance_code: true })
  .extend({
    property_id: stayImportRecordSchema.shape.property_id.describe(
      "ID of the property the stay belongs to. Must be a property administered by the authenticated user."
    ),
    check_in: z
      .string()
      .max(32)
      .describe(
        "Check-in date, in YYYY-MM-DD or DD/MM/YYYY format. It is anchored at the property's check-in time (property setting check_in_time, default 14:00) in the owner's time zone."
      ),
    check_out: z
      .string()
      .max(32)
      .describe(
        "Check-out date, in YYYY-MM-DD or DD/MM/YYYY format. Must be a later calendar day than check_in. It is anchored at the property's check-out time (property setting check_out_time, default 11:00) in the owner's time zone."
      ),
    guests: z
      .number()
      .int()
      .positive()
      .max(MAX_PROPERTY_CAPACITY)
      .describe("Number of guests staying."),
    price: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_STAY_PRICE_IN_CENTS)
      .describe("Total stay price in cents."),
    source: stayImportRecordSchema.shape.source.describe(
      "Booking source/channel, e.g. DIRECT, AIRBNB, BOOKING, or any other label used to import historic data."
    ),
    tenant_name: stayImportRecordSchema.shape.tenant_name.describe(
      "Full name of the guest staying at the property."
    ),
    tenant_phone: stayImportRecordSchema.shape.tenant_phone.describe(
      "Guest phone number, digits only, including country and area code, e.g. 5511999990000. Identifies the tenant: a phone that already exists is reused, otherwise a new tenant is created."
    ),
    tenant_sex:
      stayImportRecordSchema.shape.tenant_sex.describe("Guest's sex."),
  });

const inputSchema = {
  records: z
    .array(recordInputSchema)
    .min(1)
    .max(
      MAX_MCP_IMPORT_RECORDS,
      `records must contain at most ${MAX_MCP_IMPORT_RECORDS} items`
    )
    .describe("Stays to import, one entry per stay."),
};

function toRecordStream(
  records: z.infer<typeof recordInputSchema>[]
): ImportRecordStream {
  return (async function* () {
    let row = 0;
    for (const record of records) {
      row++;
      yield {
        row,
        values: {
          property_id: record.property_id,
          check_in: record.check_in,
          check_out: record.check_out,
          guests: String(record.guests),
          price: String(record.price),
          source: record.source,
          tenant_name: record.tenant_name,
          tenant_phone: record.tenant_phone,
          tenant_sex: record.tenant_sex,
          entrance_code: "",
        },
      };
    }
  })();
}

export function makeImportStaysTool(
  useCase: ImportBatchStaysUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "import_stays",
    requiredCapability: "bulk_import",
    description:
      "Imports stays in bulk, one call per batch of up to " +
      `${MAX_MCP_IMPORT_RECORDS} records. The whole batch is accepted or ` +
      "rejected as one: on any failure nothing is written, and the result " +
      "lists every row-level failure found while validating the rest of " +
      "the batch (best-effort for overlap/state failures once a row has " +
      "already failed). This is a destructive, non-idempotent action.",
    inputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    handler: async (input, user) => {
      try {
        return await useCase.execute(
          { records: toRecordStream(input.records) },
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
