import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { FindPropertyFinancialMovementsUseCase } from "../../application/use_case/find_property_financial_movements";
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  paginatedOutputSchema,
  toPaginationInput,
} from "../../../core/application/dto/pagination";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import { findPropertyFinancialMovementsInput } from "../schema/find_property_financial_movements.schema";
import {
  errorResponse,
  responseFromZod,
} from "../../../core/infra/http/swagger/schema_helpers";

const inputSchema = z.object(findPropertyFinancialMovementsInput).extend({
  start_date: z.coerce.date().optional(),
  end_date: z.coerce.date().optional(),
});

const financialMovementOutputSchema = z.object({
  id: z.uuid(),
  amount: z.number().int().describe("Amount in cents (negative = expense)"),
  description: z.string().nullable(),
  category: z.string(),
  property_id: z.uuid(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

const outputSchema = paginatedOutputSchema(financialMovementOutputSchema);

type Input = z.infer<typeof inputSchema>;

export class FindPropertyFinancialMovementsController implements Controller {
  path = "/finance/properties/:property_id/movements";
  method = HttpControllerMethod.GET;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Find property financial movements",
    description:
      "Returns a paginated ledger of income and expense entries for a property.",
    tags: ["Finance"],
    parameters: [
      {
        name: "property_id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      {
        name: "page",
        in: "query",
        required: false,
        schema: { type: "integer", default: DEFAULT_PAGE },
      },
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", default: DEFAULT_LIMIT },
      },
      {
        name: "start_date",
        in: "query",
        required: false,
        schema: { type: "string", format: "date-time" },
        description: "Filter entries on or after this date (ISO 8601)",
      },
      {
        name: "end_date",
        in: "query",
        required: false,
        schema: { type: "string", format: "date-time" },
        description: "Filter entries on or before this date (ISO 8601)",
      },
    ],
    responses: {
      "200": responseFromZod("Paginated financial movements", outputSchema),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Property not found"),
    },
  };

  constructor(
    private readonly useCase: FindPropertyFinancialMovementsUseCase
  ) {}

  async handle(request: ControllerRequest, user: User): Promise<unknown> {
    const input = request.body as Input;

    return this.useCase.execute(
      {
        propertyId: input.property_id,
        pagination: toPaginationInput(input),
        dateFilter: {
          start_date: input.start_date,
          end_date: input.end_date,
        },
      },
      user
    );
  }
}
