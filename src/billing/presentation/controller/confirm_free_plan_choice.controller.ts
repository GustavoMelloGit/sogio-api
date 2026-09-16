import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { ConfirmFreePlanChoiceUseCase } from "../../application/use_case/confirm_free_plan_choice";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  noContentResponse,
} from "../../../core/infra/http/swagger/schema_helpers";

export class ConfirmFreePlanChoiceController implements Controller {
  path = "/billing/subscription/free-plan";
  method = HttpControllerMethod.POST;

  openApiSpec: OpenApiOperation = {
    summary: "Confirm the Free plan as the initial plan choice",
    description:
      "Records that the authenticated user chose to stay on the Free plan, which clears `needs_plan_choice` in `GET /billing/subscription`. It never changes the plan: when the initial choice was already recorded — including for a paid subscription started through checkout — it does nothing and still returns 204. Downgrading a paid subscription goes through the billing portal, not this route.",
    tags: ["Billing"],
    responses: {
      "204": noContentResponse("Initial plan choice recorded"),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Subscription not found"),
    },
  };

  constructor(private readonly useCase: ConfirmFreePlanChoiceUseCase) {}

  async handle(_request: ControllerRequest, user: User): Promise<unknown> {
    await this.useCase.execute({}, user);
    return undefined;
  }
}
