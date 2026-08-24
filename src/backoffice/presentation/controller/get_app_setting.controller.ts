import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { GetAppSettingUseCase } from "../../application/use_case/get_app_setting";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../core/infra/http/swagger/schema_helpers";

const inputSchema = z
  .object({
    id: z.uuidv4("ID must be a valid UUID"),
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

export class GetAppSettingController implements Controller {
  path = "/settings/:id";
  method = HttpControllerMethod.GET;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Get app setting by ID",
    description: "Returns a single application configuration entry by its ID.",
    tags: ["Settings"],
    parameters: [
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    responses: {
      "200": responseFromZod("App setting found", outputSchema),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("App setting not found"),
    },
  };

  constructor(private readonly useCase: GetAppSettingUseCase) {}

  async handle(request: ControllerRequest): Promise<unknown> {
    const input = request.body as Input;

    return this.useCase.execute({ id: input.id });
  }
}
