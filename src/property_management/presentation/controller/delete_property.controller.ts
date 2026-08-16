import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { DeletePropertyUseCase } from "../../application/use_case/delete_property";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import type { RateLimitPolicy } from "../../../core/application/rate_limit/rate_limit_policy";
import {
  errorResponse,
  noContentResponse,
} from "../../../core/infra/http/swagger/schema_helpers";

/** Mirrors DeletePropertySettingController's rate limit — same destructive,
 * per-IP-limited write shape. */
const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 30,
};

const inputSchema = z
  .object({
    property_id: z.uuidv4("Property ID must be a valid UUID"),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

export class DeletePropertyController implements Controller {
  path = "/property/:property_id";
  method = HttpControllerMethod.DELETE;
  inputSchema = inputSchema;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  openApiSpec: OpenApiOperation = {
    summary: "Delete property",
    description:
      "Soft-deletes a property owned by the authenticated user. This is " +
      "permanent from the product's point of view: there is no restore " +
      "endpoint, trash, or `?include_deleted` flag. Refused with 409 when " +
      "the property has an upcoming or in-progress stay — cancel those " +
      "first.",
    tags: ["Properties"],
    parameters: [
      {
        name: "property_id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    responses: {
      "204": noContentResponse("Property deleted"),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Property not found"),
      "409": errorResponse("Property has upcoming or in-progress stays"),
    },
  };

  constructor(private readonly useCase: DeletePropertyUseCase) {}

  async handle(request: ControllerRequest, user: User): Promise<unknown> {
    const input = request.body as Input;

    await this.useCase.execute({ property_id: input.property_id }, user);
    return undefined;
  }
}
