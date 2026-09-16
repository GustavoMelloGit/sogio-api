import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { EnsureFreeSubscriptionUseCase } from "../../application/use_case/ensure_free_subscription";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  noContentResponse,
} from "../../../core/infra/http/swagger/schema_helpers";

export class EnsureFreeSubscriptionController implements Controller {
  path = "/billing/subscription/free-plan";
  method = HttpControllerMethod.POST;

  openApiSpec: OpenApiOperation = {
    summary: "Ensure the account has a subscription, defaulting to Free",
    description:
      "Guarantees the authenticated user has a Subscription: creates one on the Free plan when none exists yet, and does nothing otherwise. It never changes an existing plan — a Free, trialing, active, past_due, canceled or expired subscription is left untouched.",
    tags: ["Billing"],
    responses: {
      "204": noContentResponse("The account has a subscription"),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Plan not found"),
    },
  };

  constructor(private readonly useCase: EnsureFreeSubscriptionUseCase) {}

  async handle(_request: ControllerRequest, user: User): Promise<unknown> {
    await this.useCase.execute({ user_id: user.id });
    return undefined;
  }
}
