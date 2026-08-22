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
  MAX_LIMIT,
  MAX_PAGE,
} from "../../../core/application/dto/pagination";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../core/infra/http/swagger/schema_helpers";

const inputSchema = z.object({
  property_id: z.uuidv4("Property ID must be a valid UUID"),
  page: z.coerce.number().int().positive().max(MAX_PAGE).default(DEFAULT_PAGE),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT),
  start_date: z.coerce.date().optional(),
  end_date: z.coerce.date().optional(),
});

const outputSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().uuid(),
      amount: z.number().int().describe("Amount in cents (negative = expense)"),
      description: z.string().nullable(),
      category: z.string(),
      property_id: z.string().uuid(),
      created_at: z.string().datetime(),
      updated_at: z.string().datetime(),
    })
  ),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    total_pages: z.number().int(),
    has_next: z.boolean(),
    has_previous: z.boolean(),
  }),
});

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
        pagination: { page: input.page, limit: input.limit },
        dateFilter: {
          start_date: input.start_date,
          end_date: input.end_date,
        },
      },
      user
    );
  }
}
