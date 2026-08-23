import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { ImportLedgerEntriesUseCase } from "../../application/use_case/import_ledger_entries";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import type { RateLimitPolicy } from "../../../core/application/rate_limit/rate_limit_policy";
import { ValidationError } from "../../../core/application/error/validation_error";
import { readCsvRecordStream } from "../../../core/infra/http/csv/streaming_csv_reader";
import { importRejectedResponse } from "../../../core/presentation/controller/import_response";
import { errorResponse } from "../../../core/infra/http/swagger/schema_helpers";

const REQUIRED_COLUMNS = ["property_id", "kind", "amount", "category"] as const;

const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 10,
};

export class ImportLedgerEntriesController implements Controller {
  path = "/import/ledger-entries";
  method = HttpControllerMethod.POST;
  bodyMode = "stream" as const;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  openApiSpec: OpenApiOperation = {
    summary: "Import ledger entries",
    description: `Imports financial movements (expenses and revenues) in bulk from a CSV file. The request body is the raw file content — Content-Type must be text/csv, not multipart/form-data.

Header row is required; column order doesn't matter and unknown columns are ignored. Required columns: property_id (UUID owned by the caller), kind (expense or revenue), amount (positive integer cents — the sign is derived from kind), category (for expense: MANUTENÇÃO, ESTADIA, AQUISIÇÕES, FINANCIAMENTO, GASTOS_FIXOS, OUTROS; for revenue: free text up to 100 characters). Optional columns: description (up to 500 characters) and occurred_at (YYYY-MM-DD or DD/MM/YYYY, maps to the entry's created_at; defaults to now).

Example:

property_id,kind,amount,category,description,occurred_at
3fa85f64-5717-4562-b3fc-2c963f66afa6,expense,15000,MANUTENÇÃO,Reparo no encanamento,15/01/2026
3fa85f64-5717-4562-b3fc-2c963f66afa6,revenue,120000,Aluguel,,

The batch is accepted or rejected as a whole: a rejected batch writes nothing. Up to 1000 rows and 5 MB per request. Reimporting an already-accepted batch is not deduplicated — every row is inserted again; use DELETE /finance/properties/:property_id/movements/:entry_id to remove duplicates.`,
    tags: ["Finance"],
    responses: {
      "200": {
        description: "Batch accepted",
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
          "Import rejected — one or more rows are invalid, or the file is malformed",
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
              message: "Import rejected: 3 invalid rows",
              failures: [
                {
                  row: 2,
                  field: "amount",
                  message: "Amount must be a positive integer of cents",
                },
                {
                  row: 7,
                  field: "category",
                  message:
                    "Category must be one of: MANUTENÇÃO, ESTADIA, AQUISIÇÕES, FINANCIAMENTO, GASTOS_FIXOS, OUTROS",
                },
                { row: 9, field: null, message: "Property not found" },
              ],
              truncated: false,
            },
          },
        },
      },
    },
  };

  constructor(private readonly useCase: ImportLedgerEntriesUseCase) {}

  async handle(request: ControllerRequest, user: User): Promise<unknown> {
    const contentType = request.headers["content-type"] ?? "";
    if (!contentType.includes("text/csv")) {
      throw new ValidationError("Content-Type must be text/csv");
    }

    if (!request.bodyStream) {
      throw new ValidationError("Request body is required");
    }

    const records = readCsvRecordStream(request.bodyStream, REQUIRED_COLUMNS);

    try {
      return await this.useCase.execute({ records }, user);
    } catch (error) {
      return importRejectedResponse(error);
    }
  }
}
