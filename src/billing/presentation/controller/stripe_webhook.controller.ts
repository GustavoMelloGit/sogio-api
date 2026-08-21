import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { ProcessGatewayWebhookUseCase } from "../../application/use_case/process_gateway_webhook";
import type { RateLimitPolicy } from "../../../core/application/rate_limit/rate_limit_policy";

const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 300,
};

export class StripeWebhookController implements Controller {
  path = "/billing/webhooks/stripe";
  method = HttpControllerMethod.POST;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  constructor(private readonly useCase: ProcessGatewayWebhookUseCase) {}

  async handle(request: ControllerRequest) {
    await this.useCase.execute({
      raw_payload: request.rawBody ?? "",
      signature: request.headers["stripe-signature"] ?? null,
    });

    return { received: true };
  }
}
