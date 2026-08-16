import Stripe from "stripe";
import { UnauthorizedError } from "../../../core/application/error/unauthorized_error";
import type { Logger } from "../../../core/application/logger/logger";
import type { GatewayWebhookVerifier } from "../../application/gateway/gateway_webhook_verifier";
import type {
  GatewayBillingEvent,
  GatewaySubscriptionStatus,
} from "../../application/gateway/gateway_billing_event";

const KNOWN_SUBSCRIPTION_STATUSES: readonly string[] = [
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "paused",
];

function isKnownSubscriptionStatus(
  status: string
): status is GatewaySubscriptionStatus {
  return KNOWN_SUBSCRIPTION_STATUSES.includes(status);
}

/**
 * One of only two files in this codebase that import the Stripe SDK (DA-1,
 * alongside `StripePaymentGateway`). `verify` is the entire trust boundary
 * for the webhook (DA-2): nothing downstream ever sees a payload this
 * method hasn't authenticated.
 */
export class StripeWebhookVerifier implements GatewayWebhookVerifier {
  #webhookSecret: string;
  #logger: Logger;

  constructor(webhookSecret: string, logger: Logger) {
    this.#webhookSecret = webhookSecret;
    this.#logger = logger;
  }

  async verify(input: {
    raw_payload: string;
    signature: string | null;
  }): Promise<GatewayBillingEvent | null> {
    if (!input.signature) {
      throw new UnauthorizedError("Missing Stripe-Signature header");
    }

    let event: Stripe.Event;
    try {
      // The default tolerance (5 minutes) is left untouched (DA-2 item 3) —
      // it is what keeps a captured, legitimate payload from being replayed.
      event = await Stripe.webhooks.constructEventAsync(
        input.raw_payload,
        input.signature,
        this.#webhookSecret
      );
    } catch {
      throw new UnauthorizedError("Invalid Stripe webhook signature");
    }

    return this.#normalize(event);
  }

  #normalize(event: Stripe.Event): GatewayBillingEvent | null {
    const occurred_at = new Date(event.created * 1000);

    switch (event.type) {
      case "checkout.session.completed":
        return this.#normalizeCheckoutCompleted(event, occurred_at);
      case "customer.subscription.created":
      case "customer.subscription.updated":
        return this.#normalizeSubscriptionStateChanged(event, occurred_at);
      case "customer.subscription.deleted":
        return this.#normalizeSubscriptionEnded(event, occurred_at);
      case "invoice.payment_failed":
        return this.#normalizePaymentFailed(event, occurred_at);
      default:
        this.#logger.debug("Ignoring unhandled Stripe event type", {
          event_id: event.id,
          type: event.type,
        });
        return null;
    }
  }

  #normalizeCheckoutCompleted(
    event: Stripe.CheckoutSessionCompletedEvent,
    occurred_at: Date
  ): GatewayBillingEvent | null {
    const session = event.data.object;
    const user_id = session.client_reference_id;
    const external_customer_reference = this.#idOf(session.customer);

    if (!user_id || !external_customer_reference) {
      this.#logger.debug(
        "Ignoring checkout.session.completed without client_reference_id or customer",
        { event_id: event.id }
      );
      return null;
    }

    return {
      type: "checkout_completed",
      event_id: event.id,
      occurred_at,
      user_id,
      external_customer_reference,
      external_reference: this.#idOf(session.subscription),
    };
  }

  #normalizeSubscriptionStateChanged(
    event:
      | Stripe.CustomerSubscriptionCreatedEvent
      | Stripe.CustomerSubscriptionUpdatedEvent,
    occurred_at: Date
  ): GatewayBillingEvent | null {
    const subscription = event.data.object;
    const external_customer_reference = this.#idOf(subscription.customer);
    const item = subscription.items.data[0];

    if (!external_customer_reference || !item) {
      this.#logger.debug(
        "Ignoring subscription event without a customer or item",
        { event_id: event.id }
      );
      return null;
    }

    if (!isKnownSubscriptionStatus(subscription.status)) {
      // Forward-compat escape hatch (Stripe's `OtherString`): a status this
      // SDK release doesn't know about is safer ignored than guessed at.
      this.#logger.debug("Ignoring subscription event with unknown status", {
        event_id: event.id,
        status: subscription.status,
      });
      return null;
    }

    return {
      type: "subscription_state_changed",
      event_id: event.id,
      occurred_at,
      external_reference: subscription.id,
      external_customer_reference,
      external_price_reference: item.price.id,
      status: subscription.status,
      current_period_end: new Date(item.current_period_end * 1000),
      trial_end: subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : null,
    };
  }

  #normalizeSubscriptionEnded(
    event: Stripe.CustomerSubscriptionDeletedEvent,
    occurred_at: Date
  ): GatewayBillingEvent | null {
    const subscription = event.data.object;
    const external_customer_reference = this.#idOf(subscription.customer);

    if (!external_customer_reference) {
      this.#logger.debug(
        "Ignoring customer.subscription.deleted without a customer",
        { event_id: event.id }
      );
      return null;
    }

    return {
      type: "subscription_ended",
      event_id: event.id,
      occurred_at,
      external_reference: subscription.id,
      external_customer_reference,
    };
  }

  #normalizePaymentFailed(
    event: Stripe.InvoicePaymentFailedEvent,
    occurred_at: Date
  ): GatewayBillingEvent | null {
    const invoice = event.data.object;
    const external_reference = this.#idOf(
      invoice.parent?.subscription_details?.subscription ?? null
    );
    const external_customer_reference = this.#idOf(invoice.customer);

    if (!external_reference || !external_customer_reference) {
      this.#logger.debug(
        "Ignoring invoice.payment_failed not tied to a subscription",
        { event_id: event.id }
      );
      return null;
    }

    return {
      type: "payment_failed",
      event_id: event.id,
      occurred_at,
      external_reference,
      external_customer_reference,
      reason:
        invoice.last_finalization_error?.decline_code ??
        invoice.last_finalization_error?.code ??
        null,
    };
  }

  #idOf(value: string | { id: string } | null | undefined): string | null {
    if (!value) return null;
    return typeof value === "string" ? value : value.id;
  }
}
