import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { ListPropertySettingsUseCase } from "../../application/use_case/list_property_settings";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../core/infra/http/swagger/schema_helpers";
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  paginatedOutputSchema,
  paginationFields,
  toPaginationInput,
} from "../../../core/application/dto/pagination";
import { settingTypeSchema } from "../../../core/domain/value_object/setting_value";

const inputSchema = z
  .object({
    property_id: z.uuidv4("Property ID must be a valid UUID"),
    ...paginationFields,
  })
  .strict();

const propertySettingOutputSchema = z.object({
  id: z.string().uuid(),
  property_id: z.string().uuid(),
  key: z.string(),
  value: z.unknown(),
  type: settingTypeSchema,
  description: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

const outputSchema = paginatedOutputSchema(propertySettingOutputSchema);

type Input = z.infer<typeof inputSchema>;

export class ListPropertySettingsController implements Controller {
  path = "/property/:property_id/settings";
  method = HttpControllerMethod.GET;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "List property settings",
    description:
      "Returns a paginated list of configuration entries scoped to a single property.",
    tags: ["Property Settings"],
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
    ],
    responses: {
      "200": responseFromZod("Paginated property settings", outputSchema),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Property not found"),
    },
  };

  constructor(private readonly useCase: ListPropertySettingsUseCase) {}

  async handle(request: ControllerRequest, user: User): Promise<unknown> {
    const input = request.body as Input;

    return this.useCase.execute(
      {
        property_id: input.property_id,
        pagination: toPaginationInput(input),
      },
      user
    );
  }
}
