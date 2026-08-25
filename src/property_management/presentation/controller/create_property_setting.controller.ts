import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { CreatePropertySettingUseCase } from "../../application/use_case/create_property_setting";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import type { RateLimitPolicy } from "../../../core/application/rate_limit/rate_limit_policy";
import {
  bodyFromZod,
  errorResponse,
  responseFromZod,
  validationErrorResponse,
} from "../../../core/infra/http/swagger/schema_helpers";
import { settingTypeSchema } from "../../../core/domain/value_object/setting_value";
import { createPropertySettingInput } from "../schema/create_property_setting.schema";

/** Per-IP limit on this write route, mirroring the auth delegated-access
 * controllers' pattern (see `RegisterAppController`). */
const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 30,
};

const inputSchema = z.object(createPropertySettingInput).strict();

const outputSchema = z.object({
  id: z.uuid(),
  property_id: z.uuid(),
  key: z.string(),
  value: z.unknown(),
  type: settingTypeSchema,
  description: z.string().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

type Input = z.infer<typeof inputSchema>;

export class CreatePropertySettingController implements Controller {
  path = "/property/:property_id/settings";
  method = HttpControllerMethod.POST;
  inputSchema = inputSchema;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  openApiSpec: OpenApiOperation = {
    summary: "Create property setting",
    description: "Creates a new configuration entry scoped to a property.",
    tags: ["Property Settings"],
    parameters: [
      {
        name: "property_id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    requestBody: bodyFromZod(inputSchema.omit({ property_id: true }), {
      example: {
        key: "display_currency",
        value: "BRL",
        type: "string",
        description: "Currency used to display prices for this property",
      },
    }),
    responses: {
      "200": responseFromZod("Property setting created", outputSchema),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Property not found"),
      "409": errorResponse(
        "Property setting key already exists, or the property has reached the maximum number of active settings"
      ),
      "422": validationErrorResponse(),
    },
  };

  constructor(private readonly useCase: CreatePropertySettingUseCase) {}

  async handle(request: ControllerRequest, user: User): Promise<unknown> {
    const input = request.body as Input;

    return this.useCase.execute(
      {
        property_id: input.property_id,
        key: input.key,
        value: input.value,
        type: input.type,
        description: input.description ?? null,
      },
      user
    );
  }
}
