import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { User } from "../../../../auth/domain/entity/user";
import type { UpdateExternalBookingSourceUseCase } from "../../../application/use_case/property/update_external_booking_source";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import type { RateLimitPolicy } from "../../../../core/application/rate_limit/rate_limit_policy";
import {
  bodyFromZod,
  errorResponse,
  responseFromZod,
  validationErrorResponse,
} from "../../../../core/infra/http/swagger/schema_helpers";
import { KNOWN_EXTERNAL_BOOKING_PLATFORMS } from "../../../domain/entity/external_booking_source";

/** Per-IP limit on this write route, mirroring
 * `UpdatePropertySettingController`. */
const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 30,
};

const PLATFORM_NAME_DESCRIPTION =
  "Name of the external platform the calendar comes from. Any provider that " +
  "publishes an iCal feed works, not just a fixed list. Known examples: " +
  KNOWN_EXTERNAL_BOOKING_PLATFORMS.join(", ") +
  ". Stored as an uppercase slug: the value is normalized (trimmed, " +
  "uppercased, spaces/hyphens collapsed to underscores) before being saved.";

const inputSchema = z
  .object({
    property_id: z.uuidv4("Property ID must be a valid UUID"),
    id: z.uuidv4("ID must be a valid UUID"),
    platform_name: z
      .string()
      .max(50)
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9 _-]{1,49}$/,
        "Platform name must be 2-50 characters, starting with a letter or " +
          "digit, using only letters, digits, spaces, underscores or hyphens"
      )
      .describe(PLATFORM_NAME_DESCRIPTION)
      .optional(),
    sync_url: z
      .url()
      .max(2048, "Sync URL must be at most 2048 characters")
      .optional(),
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

export class UpdateExternalBookingSourceController implements Controller {
  path = "/booking/property/:property_id/external-booking/:id";
  method = HttpControllerMethod.PUT;
  inputSchema = inputSchema;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  openApiSpec: OpenApiOperation = {
    summary: "Update external booking source",
    description:
      "Partially updates a calendar connected to a property. The property " +
      "it belongs to is immutable — moving a calendar to another property " +
      "means registering a new one.",
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
    requestBody: bodyFromZod(
      inputSchema.omit({ property_id: true, id: true }),
      {
        example: {
          platform_name: "AIRBNB",
          sync_url:
            "https://www.airbnb.com/calendar/ical/12345678.ics?s=abcdef1234567890",
        },
      }
    ),
    responses: {
      "200": responseFromZod("External booking source updated", outputSchema),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("External booking source not found"),
      "422": validationErrorResponse(),
    },
  };

  constructor(private readonly useCase: UpdateExternalBookingSourceUseCase) {}

  async handle(request: ControllerRequest, user: User): Promise<unknown> {
    const input = request.body as Input;

    return this.useCase.execute(
      {
        property_id: input.property_id,
        id: input.id,
        platform_name: input.platform_name,
        sync_url: input.sync_url,
      },
      user
    );
  }
}
