import { z } from "zod";
import type { ImportBatchPropertiesUseCase } from "../../application/use_case/import_batch_properties";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import {
  ImportRejectedError,
  MAX_MCP_IMPORT_RECORDS,
} from "../../../core/application/import/import_failure";
import type { ImportRecordStream } from "../../../core/application/import/source_record";
import { MAX_PROPERTY_CAPACITY } from "../../domain/entity/property";

const recordSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be at most 100 characters"),
  capacity: z
    .number()
    .int("Capacity must be an integer")
    .positive("Capacity must be greater than 0")
    .max(
      MAX_PROPERTY_CAPACITY,
      `Capacity must be at most ${MAX_PROPERTY_CAPACITY}`
    ),
  street: z
    .string()
    .min(1, "Street is required")
    .max(100, "Street must be at most 100 characters"),
  number: z
    .string()
    .min(1, "Number is required")
    .max(20, "Number must be at most 20 characters"),
  neighborhood: z
    .string()
    .min(1, "Neighborhood is required")
    .max(100, "Neighborhood must be at most 100 characters"),
  city: z
    .string()
    .min(1, "City is required")
    .max(100, "City must be at most 100 characters"),
  state: z
    .string()
    .min(1, "State is required")
    .max(100, "State must be at most 100 characters"),
  zip_code: z
    .string()
    .min(1, "Zip code is required")
    .max(20, "Zip code must be at most 20 characters"),
  country: z
    .string()
    .min(1, "Country is required")
    .max(100, "Country must be at most 100 characters"),
  complement: z
    .string()
    .max(100, "Complement must be at most 100 characters")
    .optional(),
  images: z
    .array(z.string().max(2048, "Image URL must be at most 2048 characters"))
    .optional(),
});

type PropertyImportRecordInput = z.infer<typeof recordSchema>;

const inputSchema = {
  records: z
    .array(recordSchema)
    .max(
      MAX_MCP_IMPORT_RECORDS,
      `At most ${MAX_MCP_IMPORT_RECORDS} records per call`
    )
    .describe(
      "Properties to import. Same fields and limits as the CSV columns of POST /import/properties: name, capacity, and the full address. images is an optional list of URLs."
    ),
};

function toValues(record: PropertyImportRecordInput): Record<string, string> {
  const values: Record<string, string> = {
    name: record.name,
    capacity: String(record.capacity),
    street: record.street,
    number: record.number,
    neighborhood: record.neighborhood,
    city: record.city,
    state: record.state,
    zip_code: record.zip_code,
    country: record.country,
  };

  if (record.complement !== undefined) {
    values.complement = record.complement;
  }

  if (record.images !== undefined) {
    values.images = record.images.join("|");
  }

  return values;
}

async function* toRecordStream(
  records: PropertyImportRecordInput[]
): ImportRecordStream {
  let row = 0;
  for (const record of records) {
    row++;
    yield { row, values: toValues(record) };
  }
}

/**
 * Wires the existing `ImportBatchPropertiesUseCase` (already used by
 * `POST /import/properties`) as an MCP tool. Records arrive already
 * structured, so this tool never touches a file — it only adapts the typed
 * array into the same `ImportRecordStream` contract the CSV controller
 * builds, and lets the use case's own schema run the real validation.
 */
export function makeImportPropertiesTool(
  useCase: ImportBatchPropertiesUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "import_properties",
    description: `Imports properties in bulk, up to ${MAX_MCP_IMPORT_RECORDS} records per call. The batch is accepted or rejected as a whole: a record that fails validation rolls back the entire import, and the failures are returned so they can be fixed and retried. If the batch would push the account over its property quota, the entire batch is rejected — never partially imported.`,
    inputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
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
