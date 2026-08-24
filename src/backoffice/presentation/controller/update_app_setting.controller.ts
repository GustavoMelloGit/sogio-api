import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { UpdateAppSettingUseCase } from "../../application/use_case/update_app_setting";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  bodyFromZod,
  errorResponse,
  responseFromZod,
  validationErrorResponse,
} from "../../../core/infra/http/swagger/schema_helpers";
import { boundedJsonValue } from "../../domain/entity/app_setting";

const inputSchema = z
  .object({
    id: z.uuidv4("ID must be a valid UUID"),
    value: boundedJsonValue.optional(),
    type: z.enum(["string", "number", "boolean", "json"]).optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .strict();

const outputSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  value: z.unknown(),
  type: z.enum(["string", "number", "boolean", "json"]),
  description: z.string().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

type Input = z.infer<typeof inputSchema>;

export class UpdateAppSettingController implements Controller {
  path = "/settings/:id";
  method = HttpControllerMethod.PUT;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Update app setting",
    description:
      "Partially updates an application configuration entry. The key is immutable.",
    tags: ["Settings"],
    parameters: [
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    requestBody: bodyFromZod(inputSchema.omit({ id: true }), {
      example: {
        value: "Olá {cohost_name}, os dados da estadia são: {stay_details}",
        type: "string",
        description:
          "Template da mensagem para o coanfitrião com dados da estadia",
      },
    }),
    responses: {
      "200": responseFromZod("App setting updated", outputSchema),
      "401": errorResponse("Unauthorized"),
      "403": errorResponse("Forbidden — admin role required"),
      "404": errorResponse("App setting not found"),
      "422": validationErrorResponse(),
    },
  };

  constructor(private readonly useCase: UpdateAppSettingUseCase) {}

  async handle(request: ControllerRequest): Promise<unknown> {
    const input = request.body as Input;

    return this.useCase.execute({
      id: input.id,
      value: input.value,
      type: input.type,
      description: input.description,
    });
  }
}
