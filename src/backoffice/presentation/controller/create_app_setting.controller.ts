import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { CreateAppSettingUseCase } from "../../application/use_case/create_app_setting";
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
    key: z
      .string()
      .min(1)
      .max(255)
      .regex(
        /^[a-z0-9_.-]+$/,
        "Key must contain only lowercase letters, digits, underscores, dots and hyphens"
      ),
    value: boundedJsonValue,
    type: z.enum(["string", "number", "boolean", "json"]),
    description: z
      .string()
      .max(500)
      .optional()
      .transform(val => val ?? null),
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

export class CreateAppSettingController implements Controller {
  path = "/settings";
  method = HttpControllerMethod.POST;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Create app setting",
    description: "Creates a new application configuration entry.",
    tags: ["Settings"],
    requestBody: bodyFromZod(inputSchema, {
      example: {
        key: "cohost_stay_message_template",
        value: "Olá {cohost_name}, os dados da estadia são: {stay_details}",
        type: "string",
        description:
          "Template da mensagem para o coanfitrião com dados da estadia",
      },
    }),
    responses: {
      "200": responseFromZod("App setting created", outputSchema),
      "401": errorResponse("Unauthorized"),
      "403": errorResponse("Forbidden — admin role required"),
      "409": errorResponse("App setting key already exists"),
      "422": validationErrorResponse(),
    },
  };

  constructor(private readonly useCase: CreateAppSettingUseCase) {}

  async handle(request: ControllerRequest): Promise<unknown> {
    const input = request.body as Input;

    return this.useCase.execute({
      key: input.key,
      value: input.value,
      type: input.type,
      description: input.description,
    });
  }
}
