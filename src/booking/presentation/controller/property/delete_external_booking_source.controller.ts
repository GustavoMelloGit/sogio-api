import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { User } from "../../../../auth/domain/entity/user";
import type { DeleteExternalBookingSourceUseCase } from "../../../application/use_case/property/delete_external_booking_source";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import type { RateLimitPolicy } from "../../../../core/application/rate_limit/rate_limit_policy";
import {
  errorResponse,
  noContentResponse,
} from "../../../../core/infra/http/swagger/schema_helpers";

/** Per-IP limit on this write route, mirroring
 * `DeletePropertySettingController`. */
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

export class DeleteExternalBookingSourceController implements Controller {
  path = "/booking/property/:property_id/external-booking/:id";
  method = HttpControllerMethod.DELETE;
  inputSchema = inputSchema;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  openApiSpec: OpenApiOperation = {
    summary: "Delete external booking source",
    description:
      "Disconnects a calendar from a property. Soft delete: the row is " +
      "kept, but reconciliation stops reading the feed immediately.",
    tags: ["Booking"],
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
      "204": noContentResponse("External booking source deleted"),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("External booking source not found"),
    },
  };

  constructor(private readonly useCase: DeleteExternalBookingSourceUseCase) {}

  async handle(request: ControllerRequest, user: User): Promise<unknown> {
    const input = request.body as Input;

    await this.useCase.execute(
      { property_id: input.property_id, id: input.id },
      user
    );
    return undefined;
  }
}
