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

/**
 * Deliberately `allowWithoutPlatformAccess: true` in routes.ts — a blocked
 * account needs a way to see why it's blocked (DA-9 remediation path).
 */
export class GetSubscriptionStatusController implements Controller {
  path = "/billing/subscription";
  method = HttpControllerMethod.GET;

  openApiSpec: OpenApiOperation = {
    summary: "Get subscription status",
    description:
      "Returns the authenticated user's current platform entitlement — whether they have access, their subscription status, plan limits and, if blocked, why.",
    tags: ["Billing"],
    responses: {
      "200": responseFromZod("Current subscription status", outputSchema),
      "401": errorResponse("Unauthorized"),
    },
  };

  constructor(private readonly useCase: GetSubscriptionStatusUseCase) {}

  async handle(_request: ControllerRequest, user: User) {
    return this.useCase.execute({}, user);
  }
}
