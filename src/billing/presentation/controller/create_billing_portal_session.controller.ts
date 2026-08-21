import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { CreateBillingPortalSessionUseCase } from "../../application/use_case/create_billing_portal_session";
import type { RateLimitPolicy } from "../../../core/application/rate_limit/rate_limit_policy";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../core/infra/http/swagger/schema_helpers";

const outputSchema = z.object({
  url: z.string(),
});

const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 10,
};

export class CreateBillingPortalSessionController implements Controller {
  path = "/billing/portal-session";
  method = HttpControllerMethod.POST;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  openApiSpec: OpenApiOperation = {
    summary: "Create a billing portal session",
    description:
      "Creates a hosted billing portal session for the authenticated user's own gateway customer and returns its URL.",
    tags: ["Billing"],
    responses: {
      "200": responseFromZod("Billing portal session URL", outputSchema),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Subscription not found"),
      "409": errorResponse("No gateway customer yet"),
    },
  };

  constructor(private readonly useCase: CreateBillingPortalSessionUseCase) {}

  async handle(_request: ControllerRequest, user: User) {
    return this.useCase.execute({}, user);
  }
}
