import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { RecordExpenseUseCase } from "../../application/use_case/record_expense";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import { expenseCategorySchema } from "../../domain/entity/ledger_entry";
import type { RateLimitPolicy } from "../../../core/application/rate_limit/rate_limit_policy";
import {
  bodyFromZod,
  errorResponse,
  noContentResponse,
  validationErrorResponse,
} from "../../../core/infra/http/swagger/schema_helpers";

const USER_RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "user",
  windowMs: 60 * 60 * 1000,
  maxAttempts: 120,
};

const inputSchema = z.object({
  amount: z
    .int()
    .positive("Amount must be greater than 0")
    .max(
      100_000_000,
      "Amount must be at most 100000000 cents (R$ 1,000,000.00)"
    ),
  description: z
    .string()
    .max(500, "Description must be at most 500 characters")
    .optional()
    .transform(val => val ?? null),
  category: expenseCategorySchema,
  property_id: z.uuidv4("Property ID must be a valid UUID"),
});

type Input = z.infer<typeof inputSchema>;

export class RecordExpenseController implements Controller {
  path = "/finance/:property_id/expense";
  method = HttpControllerMethod.POST;
  inputSchema = inputSchema;
  userRateLimitPolicy = USER_RATE_LIMIT_POLICY;

  openApiSpec: OpenApiOperation = {
    summary: "Record expense",
    description: "Records a financial expense for a property.",
    tags: ["Finance"],
    parameters: [
      {
        name: "property_id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    requestBody: bodyFromZod(inputSchema.omit({ property_id: true }), {
      example: {
        amount: 15000,
        description: "Reparo no encanamento do banheiro",
        category: "MANUTENÇÃO",
      },
    }),
    responses: {
      "204": noContentResponse("Expense recorded successfully"),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Property not found"),
      "422": validationErrorResponse(),
    },
  };

  constructor(private readonly useCase: RecordExpenseUseCase) {}

  async handle(request: ControllerRequest, user: User): Promise<void> {
    await this.useCase.execute(request.body as Input, user);
  }
}
