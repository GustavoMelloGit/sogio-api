import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { User } from "../../../../auth/domain/entity/user";
import type { GetExternalBookingSourceUseCase } from "../../../application/use_case/property/get_external_booking_source";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../../core/infra/http/swagger/schema_helpers";

const inputSchema = z
  .object({
    property_id: z.uuidv4("Property ID must be a valid UUID"),
    id: z.uuidv4("ID must be a valid UUID"),
  })
  .strict();

const outputSchema = z.object({
  id: z.uuid(),
  property_id: z.uuid(),
  platform_name: z.string(),
  sync_url: z.url(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

type Input = z.infer<typeof inputSchema>;

export class GetExternalBookingSourceController implements Controller {
  path = "/booking/property/:property_id/external-booking/:id";
  method = HttpControllerMethod.GET;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Get external booking source",
    description: "Returns a single calendar connected to a property.",
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
      "200": responseFromZod("External booking source", outputSchema),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("External booking source not found"),
    },
  };

  constructor(private readonly useCase: GetExternalBookingSourceUseCase) {}

  async handle(request: ControllerRequest, user: User): Promise<unknown> {
    const input = request.body as Input;

    return this.useCase.execute(
      { property_id: input.property_id, id: input.id },
      user
    );
  }
}
