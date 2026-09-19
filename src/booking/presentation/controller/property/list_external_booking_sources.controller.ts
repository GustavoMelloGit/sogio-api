import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { User } from "../../../../auth/domain/entity/user";
import type { ListExternalBookingSourcesUseCase } from "../../../application/use_case/property/list_external_booking_sources";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../../core/infra/http/swagger/schema_helpers";

const inputSchema = z
  .object({
    property_id: z.uuidv4("Property ID must be a valid UUID"),
  })
  .strict();

const outputSchema = z.object({
  external_booking_sources: z.array(
    z.object({
      id: z.uuid(),
      property_id: z.uuid(),
      platform_name: z.string(),
      sync_url: z.url(),
      created_at: z.iso.datetime(),
      updated_at: z.iso.datetime(),
    })
  ),
});

type Input = z.infer<typeof inputSchema>;

export class ListExternalBookingSourcesController implements Controller {
  path = "/booking/property/:property_id/external-booking";
  method = HttpControllerMethod.GET;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "List external booking sources",
    description:
      "Returns every calendar connected to a property. Not paginated: a " +
      "property holds a handful of calendars, and the full set is what lets " +
      "a caller conclude a platform is not connected without paging.",
    tags: ["Booking"],
    parameters: [
      {
        name: "property_id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    responses: {
      "200": responseFromZod("External booking sources", outputSchema),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Property not found"),
    },
  };

  constructor(private readonly useCase: ListExternalBookingSourcesUseCase) {}

  async handle(request: ControllerRequest, user: User): Promise<unknown> {
    const input = request.body as Input;

    return this.useCase.execute({ property_id: input.property_id }, user);
  }
}
