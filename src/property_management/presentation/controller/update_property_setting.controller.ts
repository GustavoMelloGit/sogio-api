import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { UpdatePropertySettingUseCase } from "../../application/use_case/update_property_setting";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import type { RateLimitPolicy } from "../../../core/application/rate_limit/rate_limit_policy";
import {
  bodyFromZod,
  errorResponse,
  responseFromZod,
  validationErrorResponse,
} from "../../../core/infra/http/swagger/schema_helpers";
import {
  boundedJsonValue,
  settingTypeSchema,
} from "../../../core/domain/value_object/setting_value";

/** Per-IP limit on this write route, mirroring the auth delegated-access
 * controllers' pattern (see `RegisterAppController`). */
const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 30,
};

const inputSchema = z
  .object({
    property_id: z.uuidv4("Property ID must be a valid UUID"),
    id: z.uuidv4("ID must be a valid UUID"),
    value: boundedJsonValue.optional(),
    type: settingTypeSchema.optional(),
    description: z.string().max(500).nullable().optional(),
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

export class UpdatePropertySettingController implements Controller {
  path = "/property/:property_id/settings/:id";
  method = HttpControllerMethod.PUT;
  inputSchema = inputSchema;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  openApiSpec: OpenApiOperation = {
    summary: "Update property setting",
    description:
      "Partially updates a property-scoped configuration entry. The key is immutable.",
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
    requestBody: bodyFromZod(inputSchema.omit({ property_id: true, id: true })),
    responses: {
      "200": responseFromZod("Property setting updated", outputSchema),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Property or property setting not found"),
      "422": validationErrorResponse(),
    },
  };

  constructor(private readonly useCase: UpdatePropertySettingUseCase) {}

  async handle(request: ControllerRequest, user: User): Promise<unknown> {
    const input = request.body as Input;

    return this.useCase.execute(
      {
        property_id: input.property_id,
        id: input.id,
        value: input.value,
        type: input.type,
        description: input.description,
      },
      user
    );
  }
}
