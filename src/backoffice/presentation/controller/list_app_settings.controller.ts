import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { ListAppSettingsUseCase } from "../../application/use_case/list_app_settings";
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

const inputSchema = z.object(paginationFields).strict();

const appSettingOutputSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  value: z.unknown(),
  type: z.enum(["string", "number", "boolean", "json"]),
  description: z.string().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

const outputSchema = paginatedOutputSchema(appSettingOutputSchema);

type Input = z.infer<typeof inputSchema>;

export class ListAppSettingsController implements Controller {
  path = "/settings";
  method = HttpControllerMethod.GET;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "List app settings",
    description:
      "Returns a paginated list of all application configuration entries.",
    tags: ["Settings"],
    parameters: [
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
      "200": responseFromZod("Paginated app settings", outputSchema, {
        data: [
          {
            id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
            key: "cohost_stay_message_template",
            value: "Olá {cohost_name}, os dados da estadia são: {stay_details}",
            type: "string",
            description: "Template da mensagem para o coanfitrião",
            created_at: "2026-06-22T00:00:00.000Z",
            updated_at: "2026-06-22T00:00:00.000Z",
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          total_pages: 1,
          has_next: false,
          has_previous: false,
        },
      }),
      "401": errorResponse("Unauthorized"),
    },
  };

  constructor(private readonly useCase: ListAppSettingsUseCase) {}

  async handle(request: ControllerRequest): Promise<unknown> {
    const input = request.body as Input;

    return this.useCase.execute({
      pagination: toPaginationInput(input),
    });
  }
}
