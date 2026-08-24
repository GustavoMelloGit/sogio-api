import { z } from "zod";
import {
  propertyImportRecordShape,
  type ImportBatchPropertiesUseCase,
} from "../../application/use_case/import_batch_properties";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import {
  ImportRejectedError,
  MAX_MCP_IMPORT_RECORDS,
} from "../../../core/application/import/import_failure";
import type { ImportRecordStream } from "../../../core/application/import/source_record";
import { MAX_PROPERTY_IMAGES } from "../../domain/entity/property";

const recordSchema = z.object({
  name: propertyImportRecordShape.name.describe(
    "Name the owner uses to identify the property."
  ),
  capacity: propertyImportRecordShape.capacity.describe(
    "Maximum number of guests the property accommodates."
  ),
  street: propertyImportRecordShape.street.describe(
    "Street name of the property's address."
  ),
  number: propertyImportRecordShape.number.describe(
    "Street number of the property's address."
  ),
  neighborhood: propertyImportRecordShape.neighborhood.describe(
    "Neighborhood of the property's address."
  ),
  city: propertyImportRecordShape.city.describe(
    "City of the property's address."
  ),
  state: propertyImportRecordShape.state.describe(
    "State of the property's address."
  ),
  zip_code: propertyImportRecordShape.zip_code.describe(
    "Zip code of the property's address."
  ),
  country: propertyImportRecordShape.country.describe(
    "Country of the property's address."
  ),
  complement: propertyImportRecordShape.complement.describe(
    "Additional address details such as apartment or suite number. Omit for none."
  ),
  images: z
    .array(z.string().max(2048, "Image URL must be at most 2048 characters"))
    .max(MAX_PROPERTY_IMAGES, `At most ${MAX_PROPERTY_IMAGES} images`)
    .optional()
    .describe("URLs of the property photos. Omit for none."),
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

  values.complement = record.complement;

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
    requiredCapability: "bulk_import",
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
