import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { RecordRevenueUseCase } from "../../application/use_case/record_revenue";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  bodyFromZod,
  errorResponse,
  noContentResponse,
  validationErrorResponse,
} from "../../../core/infra/http/swagger/schema_helpers";

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
  category: z
    .string()
    .min(1, "Category is required")
    .max(50, "Category must be at most 50 characters"),
  property_id: z.uuidv4("Property ID must be a valid UUID"),
});

type Input = z.infer<typeof inputSchema>;

export class RecordRevenueController implements Controller {
  path = "/finance/:property_id/revenue";
  method = HttpControllerMethod.POST;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Record revenue",
    description: "Records a financial revenue entry for a property.",
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
        amount: 250000,
        description: "Pagamento da hospedagem via plataforma",
        category: "ESTADIA",
      },
    }),
    responses: {
      "204": noContentResponse("Revenue recorded successfully"),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Property not found"),
      "422": validationErrorResponse(),
    },
  };

  constructor(private readonly useCase: RecordRevenueUseCase) {}

  async handle(request: ControllerRequest, user: User): Promise<void> {
    await this.useCase.execute(request.body as Input, user);
  }
}
