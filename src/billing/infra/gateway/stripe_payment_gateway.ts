import Stripe from "stripe";
import { IllegalStateError } from "../../../core/application/error/illegal_state_error";
import type { PaymentGateway } from "../../application/gateway/payment_gateway";

/**
 * One of only two files in this codebase that import the Stripe SDK (DA-1,
 * alongside `StripeWebhookVerifier`). Every method speaks the
 * `PaymentGateway` port's vocabulary in, opaque references and URLs out —
 * no `Stripe.*` type ever crosses back into `application`.
 */
export class StripePaymentGateway implements PaymentGateway {
  #stripe: Stripe;

  constructor(secretKey: string) {
    // Pinned explicitly to the version this SDK release was generated
    // against, rather than left to the account's dashboard default — an
    // unrelated dashboard change must never silently reshape our payloads.
    this.#stripe = new Stripe(secretKey, { apiVersion: Stripe.API_VERSION });
  }

  async createCustomer(input: {
    user_id: string;
    email: string;
  }): Promise<string> {
    const customer = await this.#stripe.customers.create({
      email: input.email,
      metadata: { user_id: input.user_id },
    });

    return customer.id;
  }

  async createCheckoutSession(input: {
    external_customer_reference: string;
    external_price_reference: string;
    client_reference_id: string;
    success_url: string;
    cancel_url: string;
    trial_period_days?: number;
  }): Promise<{ url: string }> {
    const session = await this.#stripe.checkout.sessions.create({
      mode: "subscription",
      customer: input.external_customer_reference,
      client_reference_id: input.client_reference_id,
      line_items: [{ price: input.external_price_reference, quantity: 1 }],
      success_url: input.success_url,
      cancel_url: input.cancel_url,
      subscription_data:
        input.trial_period_days !== undefined
          ? { trial_period_days: input.trial_period_days }
          : undefined,
    });

    if (!session.url) {
      throw new IllegalStateError(
        "Stripe returned a checkout session without a url"
      );
    }

    return { url: session.url };
  }

  async createBillingPortalSession(input: {
    external_customer_reference: string;
    return_url: string;
  }): Promise<{ url: string }> {
    const session = await this.#stripe.billingPortal.sessions.create({
      customer: input.external_customer_reference,
      return_url: input.return_url,
    });

    return { url: session.url };
  }
}
