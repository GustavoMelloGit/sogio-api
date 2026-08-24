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
    key: z.string().min(1).max(255),
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

export class GetAppSettingByKeyController implements Controller {
  path = "/settings/key/:key";
  method = HttpControllerMethod.GET;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Get app setting by key",
    description: "Returns a single application configuration entry by its key.",
    tags: ["Settings"],
    parameters: [
      {
        name: "key",
        in: "path",
        required: true,
        schema: { type: "string" },
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

    return this.useCase.execute({ key: input.key });
  }
}
