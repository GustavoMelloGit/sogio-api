import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { ProcessGatewayWebhookUseCase } from "../../application/use_case/process_gateway_webhook";
import type { RateLimitPolicy } from "../../../core/application/rate_limit/rate_limit_policy";

/**
 * Generous on purpose — this is a flood guard, not a throughput limit. The
 * gateway is the caller, and a legitimate burst of events (bulk renewals,
 * mass dunning) must never be rate-limited into a Stripe retry storm.
 */
const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 300,
};

/**
 * `authenticated: false` by construction — the caller is the gateway, not a
 * logged-in user, so it's outside the DA-9 platform-access gate without
 * needing an exception entry. Verification of `Stripe-Signature` happens
 * inside `ProcessGatewayWebhookUseCase`, not here (DA-2): this controller
 * is deliberately a thin ~10-line shell with no business logic of its own.
 * No `openApiSpec` — a machine-to-machine endpoint has no place in a public
 * API reference meant for human integrators.
 */
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
