import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { UpdateNotificationPreferencesUseCase } from "../../application/use_case/update_notification_preferences";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  bodyFromZod,
  errorResponse,
  responseFromZod,
} from "../../../core/infra/http/swagger/schema_helpers";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPE_KEYS,
} from "../../domain/notification_type/notification_type_registry";
import { ValidationError } from "../../../core/application/error/validation_error";
import { updateNotificationPreferencesInput } from "../schema/update_notification_preferences.schema";

const inputSchema = z.object(updateNotificationPreferencesInput);

const outputSchema = z.object({
  type: z.enum(NOTIFICATION_TYPE_KEYS),
  channel: z.enum(NOTIFICATION_CHANNELS),
  enabled: z.boolean(),
});

export class UpdateNotificationPreferencesController implements Controller {
  path = "/notifications/preferences";
  method = HttpControllerMethod.PUT;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Update a notification preference",
    description:
      "Turns a notification type on or off for a given channel. Rejected with 422 for an unknown type or channel, and for a type the platform always delivers.",
    tags: ["Notifications"],
    requestBody: bodyFromZod(inputSchema, {
      example: {
        type: "subscription_trial_ending",
        channel: "email",
        enabled: false,
      },
    }),
    responses: {
      "200": responseFromZod("Preference updated", outputSchema, {
        type: "subscription_trial_ending",
        channel: "email",
        enabled: false,
      }),
      "401": errorResponse("Unauthorized"),
      "422": errorResponse("Unknown or non-optional notification type"),
    },
  };

  constructor(private readonly useCase: UpdateNotificationPreferencesUseCase) {}

  async handle(request: ControllerRequest, user: User) {
    const parsed = inputSchema.safeParse(request.body);

    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid input"
      );
    }

    return this.useCase.execute(parsed.data, user);
  }
}
