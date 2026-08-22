import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { GetSubscriptionStatusUseCase } from "../../application/use_case/get_subscription_status";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../core/infra/http/swagger/schema_helpers";

const outputSchema = z.object({
  has_platform_access: z.boolean(),
  status: z.string(),
  max_properties: z.int(),
  blocked_reason: z
    .enum([
      "trial_expired",
      "period_expired",
      "payment_failed",
      "no_subscription",
    ])
    .optional(),
});

export class GetSubscriptionStatusController implements Controller {
  path = "/billing/subscription";
  method = HttpControllerMethod.GET;

  openApiSpec: OpenApiOperation = {
    summary: "Get subscription status",
    description:
      "Returns the authenticated user's current platform entitlement — whether they have access, their subscription status, plan limits and, if blocked, why.",
    tags: ["Billing"],
    responses: {
      "200": responseFromZod("Current subscription status", outputSchema, {
        has_platform_access: true,
        status: "active",
        max_properties: 5,
      }),
      "401": errorResponse("Unauthorized"),
    },
  };

  constructor(private readonly useCase: GetSubscriptionStatusUseCase) {}

  async handle(_request: ControllerRequest, user: User) {
    return this.useCase.execute({}, user);
  }
}
