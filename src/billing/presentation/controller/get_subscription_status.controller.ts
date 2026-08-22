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
  plan: z
    .object({
      id: z.uuid(),
      code: z.string(),
      name: z.string(),
    })
    .nullable(),
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
      "Returns the authenticated user's current platform entitlement — whether they have access, their subscription status, the plan whose limits actually apply and, if blocked, why. The plan is the effective one: a canceled subscription past its paid period reports the Free plan, matching max_properties.",
    tags: ["Billing"],
    responses: {
      "200": responseFromZod("Current subscription status", outputSchema, {
        has_platform_access: true,
        status: "active",
        max_properties: 5,
        plan: {
          id: "7b2d9e04-1c5f-4e83-8a77-9f0c3b5d2e64",
          code: "pro",
          name: "Pro",
        },
      }),
      "401": errorResponse("Unauthorized"),
    },
  };

  constructor(private readonly useCase: GetSubscriptionStatusUseCase) {}

  async handle(_request: ControllerRequest, user: User) {
    return this.useCase.execute({}, user);
  }
}
