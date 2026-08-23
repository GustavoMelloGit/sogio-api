import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { DeleteLedgerEntryUseCase } from "../../application/use_case/delete_ledger_entry";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import type { RateLimitPolicy } from "../../../core/application/rate_limit/rate_limit_policy";
import {
  errorResponse,
  noContentResponse,
} from "../../../core/infra/http/swagger/schema_helpers";

const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 30,
};

const inputSchema = z
  .object({
    property_id: z.uuidv4("Property ID must be a valid UUID"),
    entry_id: z.uuidv4("Entry ID must be a valid UUID"),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

export class DeleteLedgerEntryController implements Controller {
  path = "/finance/properties/:property_id/movements/:entry_id";
  method = HttpControllerMethod.DELETE;
  inputSchema = inputSchema;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  openApiSpec: OpenApiOperation = {
    summary: "Delete ledger entry",
    description:
      "Soft-deletes a financial movement. This is a remediation mechanism (e.g. a duplicated import), not a reversal: the entry is marked deleted and stops counting toward the property's balance and movement listing, but the row itself is kept for audit. A stay's revenue reverting on cancellation is a separate mechanism (a counter-entry) and never goes through this route.",
    tags: ["Finance"],
    parameters: [
      {
        name: "property_id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      {
        name: "entry_id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    responses: {
      "204": noContentResponse("Ledger entry deleted"),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse(
        "Property or ledger entry not found, already deleted, or not owned by the caller"
      ),
    },
  };

  constructor(private readonly useCase: DeleteLedgerEntryUseCase) {}

  async handle(request: ControllerRequest, user: User): Promise<unknown> {
    const input = request.body as Input;

    await this.useCase.execute(
      { property_id: input.property_id, entry_id: input.entry_id },
      user
    );
    return undefined;
  }
}
