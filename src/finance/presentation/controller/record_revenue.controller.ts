import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { RecordRevenueUseCase } from "../../application/use_case/record_revenue";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import { recordRevenueInput } from "../schema/record_revenue.schema";
import {
  bodyFromZod,
  errorResponse,
  noContentResponse,
  validationErrorResponse,
} from "../../../core/infra/http/swagger/schema_helpers";

const inputSchema = z.object(recordRevenueInput);

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
