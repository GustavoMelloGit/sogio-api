import z from "zod";
import type { CreateExternalBookingSourceUseCase } from "../../../application/use_case/property/create_external_booking_source";
import type { User } from "../../../../auth/domain/entity/user";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import {
  bodyFromZod,
  errorResponse,
  responseFromZod,
  validationErrorResponse,
} from "../../../../core/infra/http/swagger/schema_helpers";
import { createExternalBookingSourceInput } from "../../schema/create_external_booking_source.schema";

const inputSchema = z.object(createExternalBookingSourceInput);

const outputSchema = z.object({
  id: z.uuid(),
  property_id: z.uuid(),
  platform_name: z.string(),
  sync_url: z.url(),
});

type Input = z.infer<typeof inputSchema>;

export class CreateExternalBookingSourceController implements Controller {
  path = "/booking/property/:property_id/external-booking";
  method = HttpControllerMethod.POST;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Create external booking source",
    description:
      "Registers a calendar sync URL from an external platform for a " +
      "property. Any provider that publishes an iCal feed works.",
    tags: ["Booking"],
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
        platform_name: "AIRBNB",
        sync_url:
          "https://www.airbnb.com/calendar/ical/12345678.ics?s=abcdef1234567890",
      },
    }),
    responses: {
      "200": responseFromZod("External booking source created", outputSchema),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Property not found"),
      "422": validationErrorResponse(),
    },
  };

  constructor(private readonly useCase: CreateExternalBookingSourceUseCase) {}

  async handle(request: ControllerRequest, user: User) {
    const input = request.body as Input;

    const output = await this.useCase.execute({
      platform_name: input.platform_name,
      sync_url: input.sync_url,
      property_id: input.property_id,
      user_id: user.id,
    });

    return output;
  }
}
