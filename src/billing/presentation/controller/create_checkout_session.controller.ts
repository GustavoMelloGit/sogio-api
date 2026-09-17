import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import {
  CHECKOUT_RETURN_TARGETS,
  type CreateCheckoutSessionUseCase,
} from "../../application/use_case/create_checkout_session";
import type { RateLimitPolicy } from "../../../core/application/rate_limit/rate_limit_policy";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  bodyFromZod,
  errorResponse,
  responseFromZod,
} from "../../../core/infra/http/swagger/schema_helpers";

const inputSchema = z.object({
  plan_code: z.string().min(1).max(50),
  return_to: z.enum(CHECKOUT_RETURN_TARGETS).default("billing"),
});

const outputSchema = z.object({
  url: z.string(),
});

type Input = z.infer<typeof inputSchema>;

const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 10,
};

export class CreateCheckoutSessionController implements Controller {
  path = "/billing/checkout-session";
  method = HttpControllerMethod.POST;
  inputSchema = inputSchema;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  openApiSpec: OpenApiOperation = {
    summary: "Create a checkout session",
    description:
      "Creates a hosted checkout session for the given plan and returns its URL. The caller only ever gets redirected — no card data ever reaches this API. `return_to` picks where the gateway sends the user back, from a fixed set: `billing` (default) returns to the billing settings page, `onboarding` returns to the app home. Both append `checkout=success` or `checkout=canceled`.",
    tags: ["Billing"],
    requestBody: bodyFromZod(inputSchema, {
      example: {
        plan_code: "pro",
        return_to: "onboarding",
      },
    }),
    responses: {
      "200": responseFromZod("Checkout session URL", outputSchema, {
        url: "https://checkout.stripe.com/c/pay/cs_test_a1FpQ8xKZ2mWvL9nY3bR7dJ6",
      }),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Plan or subscription not found"),
      "409": errorResponse("A gateway subscription is already live"),
      "422": errorResponse("Invalid input"),
    },
  };

  constructor(private readonly useCase: CreateCheckoutSessionUseCase) {}

  async handle(request: ControllerRequest, user: User) {
    const input = request.body as Input;

    return this.useCase.execute(
      { plan_code: input.plan_code, return_to: input.return_to },
      user
    );
  }
}
