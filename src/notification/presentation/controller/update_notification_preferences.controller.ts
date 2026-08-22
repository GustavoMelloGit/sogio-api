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
  errorResponse,
  responseFromZod,
} from "../../../core/infra/http/swagger/schema_helpers";
import { NOTIFICATION_CHANNELS } from "../../domain/notification_type/notification_type_registry";
import { ValidationError } from "../../../core/application/error/validation_error";

const inputSchema = z.object({
  type: z.string().min(1).max(100),
  channel: z.string().min(1).max(50),
  enabled: z.boolean(),
});

const outputSchema = z.object({
  type: z.string().min(1).max(100),
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
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["type", "channel", "enabled"],
            properties: {
              type: { type: "string", example: "stay_upcoming" },
              channel: { type: "string", example: "email" },
              enabled: { type: "boolean", example: false },
            },
          },
        },
      },
    },
    responses: {
      "200": responseFromZod("Preference updated", outputSchema, {
        type: "stay_upcoming",
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
