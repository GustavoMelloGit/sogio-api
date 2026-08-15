import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { GetPropertySettingUseCase } from "../../application/use_case/get_property_setting";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../core/infra/http/swagger/schema_helpers";
import { settingTypeSchema } from "../../../core/domain/value_object/setting_value";

const inputSchema = z
  .object({
    property_id: z.uuidv4("Property ID must be a valid UUID"),
    id: z.uuidv4("ID must be a valid UUID"),
  })
  .strict();

const outputSchema = z.object({
  id: z.string().uuid(),
  property_id: z.string().uuid(),
  key: z.string(),
  value: z.unknown(),
  type: settingTypeSchema,
  description: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

type Input = z.infer<typeof inputSchema>;

export class GetPropertySettingController implements Controller {
  path = "/property/:property_id/settings/:id";
  method = HttpControllerMethod.GET;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Get property setting by ID",
    description:
      "Returns a single configuration entry scoped to a property by its ID.",
    tags: ["Property Settings"],
    parameters: [
      {
        name: "property_id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    responses: {
      "200": responseFromZod("Property setting found", outputSchema),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Property or property setting not found"),
    },
  };

  constructor(private readonly useCase: GetPropertySettingUseCase) {}

  async handle(request: ControllerRequest, user: User): Promise<unknown> {
    const input = request.body as Input;

    return this.useCase.execute(
      { property_id: input.property_id, id: input.id },
      user
    );
  }
}
