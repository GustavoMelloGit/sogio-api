import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { DeletePropertySettingUseCase } from "../../application/use_case/delete_property_setting";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import type { RateLimitPolicy } from "../../../core/application/rate_limit/rate_limit_policy";
import {
  errorResponse,
  noContentResponse,
} from "../../../core/infra/http/swagger/schema_helpers";

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
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

export class DeletePropertySettingController implements Controller {
  path = "/property/:property_id/settings/:id";
  method = HttpControllerMethod.DELETE;
  inputSchema = inputSchema;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  openApiSpec: OpenApiOperation = {
    summary: "Delete property setting",
    description: "Soft-deletes a property-scoped configuration entry.",
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
      "204": noContentResponse("Property setting deleted"),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Property or property setting not found"),
    },
  };

  constructor(private readonly useCase: DeletePropertySettingUseCase) {}

  async handle(request: ControllerRequest, user: User): Promise<unknown> {
    const input = request.body as Input;

    await this.useCase.execute(
      { property_id: input.property_id, id: input.id },
      user
    );
    return undefined;
  }
}
