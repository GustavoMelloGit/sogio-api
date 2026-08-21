import Stripe from "stripe";
import { IllegalStateError } from "../../../core/application/error/illegal_state_error";
import type { Logger } from "../../../core/application/logger/logger";
import type { PaymentGateway } from "../../application/gateway/payment_gateway";
import type { GatewayCatalogEntry } from "../../application/gateway/gateway_catalog_entry";
import { parseStripeCatalogEntry } from "./stripe_catalog_entry_parser";

export class StripePaymentGateway implements PaymentGateway {
  #stripe: Stripe;
  #logger: Logger;

  constructor(secretKey: string, logger: Logger) {
    this.#stripe = new Stripe(secretKey, { apiVersion: Stripe.API_VERSION });
    this.#logger = logger;
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
      allow_promotion_codes: true,
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

  async listCatalogEntries(): Promise<GatewayCatalogEntry[]> {
    const entries: GatewayCatalogEntry[] = [];

    for await (const price of this.#stripe.prices.list({ limit: 100 })) {
      const entry = parseStripeCatalogEntry(price, this.#logger);
      if (entry) entries.push(entry);
    }

    return entries;
  }
}
