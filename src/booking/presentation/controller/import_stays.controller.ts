import type { ImportStaysUseCase } from "../../application/use_case/import_stays";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import type { RateLimitPolicy } from "../../../core/application/rate_limit/rate_limit_policy";
import { errorResponse } from "../../../core/infra/http/swagger/schema_helpers";
import { readCsvRecordStream } from "../../../core/infra/http/csv/streaming_csv_reader";
import { importRejectedResponse } from "../../../core/presentation/controller/import_response";
import { ValidationError } from "../../../core/application/error/validation_error";

const REQUIRED_COLUMNS = [
  "property_id",
  "check_in",
  "check_out",
  "guests",
  "price",
  "source",
  "tenant_name",
  "tenant_phone",
  "tenant_sex",
] as const;

const CSV_EXAMPLE = [
  [...REQUIRED_COLUMNS, "entrance_code"].join(","),
  [
    "11111111-1111-1111-1111-111111111111",
    "2026-01-10",
    "2026-01-15",
    "2",
    "150000",
    "AIRBNB",
    "Maria Silva",
    "5511999990000",
    "FEMALE",
    "",
  ].join(","),
].join("\n");

/** Per-IP limit on this write route. Bulk import can write up to
 * `MAX_IMPORT_ROWS` stays per request, so the write amplification is far
 * higher than a single booking (R-4). */
const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 5,
};

export class ImportStaysController implements Controller {
  path = "/import/stays";
  method = HttpControllerMethod.POST;
  bodyMode = "stream" as const;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  openApiSpec: OpenApiOperation = {
    summary: "Import stays in bulk",
    description:
      "Imports stays from a CSV file, one stay per row (Content-Type: text/csv, header row required, other columns are ignored). " +
      "Every row goes through the exact same policies as booking a single stay — including the overlap check — so a stay whose " +
      "dates overlap another stay of the same property (already stored or earlier in the same file) surfaces as a line-level " +
      "failure in the 422 report, not a special case for historic data. Dates accept YYYY-MM-DD or DD/MM/YYYY. price is in cents. " +
      "entrance_code is optional and generated when absent. The whole batch is accepted or rejected as one: on any failure nothing " +
      "is written, and the 422 body lists every row-level failure found while reading the rest of the file (best-effort for " +
      "overlap/state failures once a row has already failed — see `truncated`). Example:\n\n" +
      CSV_EXAMPLE,
    tags: ["Booking"],
    responses: {
      "200": {
        description: "Import accepted",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                imported: { type: "integer" },
              },
            },
            example: { imported: 42 },
          },
        },
      },
      "401": errorResponse("Unauthorized"),
      "422": {
        description:
          "Import rejected — no row was written. `truncated` is true when the report was cut at the maximum number of reported failures.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                message: { type: "string" },
                failures: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      row: { type: "integer" },
                      field: { type: ["string", "null"] },
                      message: { type: "string" },
                    },
                  },
                },
                truncated: { type: "boolean" },
              },
            },
            example: {
              message: "Import rejected: 2 invalid rows",
              failures: [
                {
                  row: 2,
                  field: "property_id",
                  message: "Property not found",
                },
                { row: 5, field: null, message: "Property is occupied" },
              ],
              truncated: false,
            },
          },
        },
      },
    },
  };

  constructor(private readonly useCase: ImportStaysUseCase) {}

  async handle(request: ControllerRequest, user: User) {
    const contentType = (request.headers["content-type"] ?? "").toLowerCase();

    if (!contentType.startsWith("text/csv")) {
      throw new ValidationError("Content-Type must be text/csv");
    }

    if (!request.bodyStream) {
      throw new ValidationError("Request body is required");
    }

    try {
      return await this.useCase.execute(
        { records: readCsvRecordStream(request.bodyStream, REQUIRED_COLUMNS) },
        user
      );
    } catch (error) {
      return importRejectedResponse(error);
    }
  }
}
