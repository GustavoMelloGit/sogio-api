import z from "zod";
import type { FindPropertyStaysUseCase } from "../../../application/use_case/stay/find_property_stays";
import type { User } from "../../../../auth/domain/entity/user";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
  MAX_PAGE,
} from "../../../../core/application/dto/pagination";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../../core/infra/http/swagger/schema_helpers";

const inputSchema = z
  .object({
    property_id: z.uuid(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_PAGE)
      .default(DEFAULT_PAGE),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_LIMIT)
      .default(DEFAULT_LIMIT),
  })
  .refine(data => !data.from || !data.to || data.from <= data.to, {
    message: "'from' must be less than or equal to 'to'",
    path: ["from"],
  });

const stayItemOutputSchema = z.object({
  id: z.string().uuid(),
  check_in: z.string().datetime(),
  check_out: z.string().datetime(),
  entrance_code: z.string(),
  guests: z.number().int(),
  price: z.number().int().describe("Price in cents"),
  source: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: z.object({
    id: z.string().uuid(),
    name: z.string(),
    phone: z.string(),
    sex: z.enum(["MALE", "FEMALE", "OTHER"]),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  }),
});

const outputSchema = z.object({
  data: z.array(stayItemOutputSchema),
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

export class FindPropertyStaysController implements Controller {
  path = "/booking/property/:property_id/stays";
  method = HttpControllerMethod.GET;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Find property stays",
    description: "Returns a paginated list of stays for a property.",
    tags: ["Stays"],
    parameters: [
      {
        name: "property_id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      {
        name: "from",
        in: "query",
        required: false,
        schema: { type: "string", format: "date-time" },
      },
      {
        name: "to",
        in: "query",
        required: false,
        schema: { type: "string", format: "date-time" },
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
    ],
    responses: {
      "200": responseFromZod("Paginated stays list", outputSchema),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Property not found"),
    },
  };

  constructor(private readonly useCase: FindPropertyStaysUseCase) {}

  async handle(request: ControllerRequest, user: User) {
    const input = request.body as Input;

    const output = await this.useCase.execute(
      {
        property_id: input.property_id,
        pagination: { page: input.page, limit: input.limit },
        filters: { from: input.from, to: input.to },
      },
      user
    );

    return output;
  }
}
