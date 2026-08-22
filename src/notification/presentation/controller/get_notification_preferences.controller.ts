import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { GetNotificationPreferencesUseCase } from "../../application/use_case/get_notification_preferences";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../core/infra/http/swagger/schema_helpers";

const outputSchema = z.object({
  preferences: z.array(
    z.object({
      type: z.string().min(1).max(100),
      label: z.string().min(1).max(200),
      optional: z.boolean(),
      channels: z.array(
        z.object({
          channel: z.enum(["email"]),
          enabled: z.boolean(),
        })
      ),
    })
  ),
});

export class GetNotificationPreferencesController implements Controller {
  path = "/notifications/preferences";
  method = HttpControllerMethod.GET;

  openApiSpec: OpenApiOperation = {
    summary: "Get notification preferences",
    description:
      "Returns every notification type the platform can send, with the channels it uses and whether the authenticated user has them enabled. A type that has never been configured reports its default. Types marked as not optional are always delivered and cannot be turned off.",
    tags: ["Notifications"],
    responses: {
      "200": responseFromZod("Current notification preferences", outputSchema, {
        preferences: [
          {
            type: "subscription_payment_failed",
            label: "Falha no pagamento da assinatura",
            optional: false,
            channels: [{ channel: "email", enabled: true }],
          },
        ],
      }),
      "401": errorResponse("Unauthorized"),
    },
  };

  constructor(private readonly useCase: GetNotificationPreferencesUseCase) {}

  async handle(_request: ControllerRequest, user: User) {
    return this.useCase.execute(undefined, user);
  }
}
