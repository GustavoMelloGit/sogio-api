import { z } from "zod";
import type { ImportBatchPropertiesUseCase } from "../../application/use_case/import_batch_properties";
import type { User } from "../../../auth/domain/entity/user";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerHttpResponse,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  csvBody,
  errorResponse,
  responseFromZod,
} from "../../../core/infra/http/swagger/schema_helpers";
import type { RateLimitPolicy } from "../../../core/application/rate_limit/rate_limit_policy";
import { readCsvRecordStream } from "../../../core/infra/http/csv/streaming_csv_reader";
import { ValidationError } from "../../../core/application/error/validation_error";
import { importRejectedResponse } from "../../../core/presentation/controller/import_response";
import { MAX_IMPORT_ROWS } from "../../../core/application/import/import_failure";
import { MAX_REQUEST_BODY_BYTES } from "../../../core/infra/http/body/body_limits";

const REQUIRED_COLUMNS = [
  "name",
  "capacity",
  "street",
  "number",
  "neighborhood",
  "city",
  "state",
  "zip_code",
  "country",
] as const;

const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 5,
};

const outputSchema = z.object({
  imported: z.number().int(),
});

const failureSchema = z.object({
  row: z
    .number()
    .int()
    .min(1)
    .max(MAX_IMPORT_ROWS + 1),
  field: z.string().max(100).nullable(),
  message: z.string().max(500),
});

const rejectedResponseSchema = z.object({
  message: z.string(),
  failures: z.array(failureSchema),
  truncated: z.boolean(),
});

const CSV_LAYOUT_EXAMPLE = [
  "name,capacity,street,number,neighborhood,city,state,zip_code,country,complement,images",
  "Apartamento Vista Mar,4,Avenida Beira Mar,1200,Praia do Canto,Vitória,ES,29055-000,Brasil,Apto 302,https://cdn.sogio.com/1.jpg|https://cdn.sogio.com/2.jpg",
].join("\n");

const CSV_LAYOUT_DESCRIPTION =
  "The first line is the header; column order does not matter and unknown columns are ignored. " +
  "Required columns: `name`, `capacity`, `street`, `number`, `neighborhood`, `city`, `state`, `zip_code`, `country`. " +
  "Optional: `complement` (defaults to empty) and `images` — multiple URLs in a single cell, separated by `|`.";

const DESCRIPTION =
  "Imports properties in bulk from a CSV file. The request body must be the raw CSV content, sent with `Content-Type: text/csv` — not wrapped in JSON or multipart/form-data. " +
  "Up to 1000 rows per file. The batch is accepted or rejected as a whole: the first invalid row rolls back the entire import, and the response reports every row-level failure found (up to 100) so the file can be fixed and resubmitted. If the batch would push the account over its property quota, the entire batch is rejected with 403 — never partially imported. " +
  `Validate the file's size on the client before uploading: above ${MAX_REQUEST_BODY_BYTES / (1024 * 1024)} MB the request is cut by the runtime before this endpoint's own validation ever runs, and the response has no body — a browser client observes that as a network failure, not as a proper rejection.`;

export class ImportPropertiesController implements Controller {
  path = "/import/properties";
  method = HttpControllerMethod.POST;
  bodyMode = "stream" as const;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  openApiSpec: OpenApiOperation = {
    summary: "Import properties",
    description: DESCRIPTION,
    tags: ["Properties"],
    requestBody: csvBody(CSV_LAYOUT_DESCRIPTION, CSV_LAYOUT_EXAMPLE),
    responses: {
      "200": responseFromZod("Batch imported", outputSchema, {
        imported: 42,
      }),
      "401": errorResponse("Unauthorized"),
      "403": errorResponse(
        "Property quota exceeded — the batch is rejected as a whole, never partially imported"
      ),
      "422": responseFromZod(
        "Batch rejected — one or more rows failed validation",
        rejectedResponseSchema,
        {
          message: "Import rejected: 2 invalid rows",
          failures: [
            {
              row: 2,
              field: "capacity",
              message: "Capacity must be greater than 0",
            },
            {
              row: 5,
              field: "zip_code",
              message: "Zip code is required",
            },
          ],
          truncated: false,
        }
      ),
    },
  };

  constructor(private readonly useCase: ImportBatchPropertiesUseCase) {}

  async handle(
    request: ControllerRequest,
    user: User
  ): Promise<unknown | ControllerHttpResponse> {
    const contentType = (request.headers["content-type"] ?? "").toLowerCase();
    if (!contentType.startsWith("text/csv")) {
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
