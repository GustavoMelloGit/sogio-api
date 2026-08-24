import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { RecordExpenseUseCase } from "../../application/use_case/record_expense";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import { recordExpenseInput } from "../schema/record_expense.schema";
import {
  bodyFromZod,
  errorResponse,
  noContentResponse,
  validationErrorResponse,
} from "../../../core/infra/http/swagger/schema_helpers";

const inputSchema = z.object(recordExpenseInput);

type Input = z.infer<typeof inputSchema>;

export class RecordExpenseController implements Controller {
  path = "/finance/:property_id/expense";
  method = HttpControllerMethod.POST;
  inputSchema = inputSchema;

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
    const input = request.body as Input;

    await this.useCase.execute(
      {
        property_id: input.property_id,
        amount: input.amount,
        category: input.category,
        description: input.description ?? null,
      },
      user
    );
  }
}
