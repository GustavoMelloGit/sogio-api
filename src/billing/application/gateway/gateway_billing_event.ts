/** Gateway-reported subscription status, normalized to the Sogio vocabulary (DA-9). */
export type GatewaySubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

type GatewayBillingEventBase = {
  /** The gateway's own event id — the idempotency key (DA-7). */
  event_id: string;
  /** The instant, in the gateway's clock, the event describes (DA-8). */
  occurred_at: Date;
};

/** Carries `client_reference_id` — the only event that ties a gateway customer back to our `user_id` (DA-2 item 5). */
export type CheckoutCompletedEvent = GatewayBillingEventBase & {
  type: "checkout_completed";
  user_id: string;
  external_customer_reference: string;
  external_reference: string | null;
};

/** The workhorse: activation, renewal, plan switch from the portal, recovery from past_due (DA-9). */
export type SubscriptionStateChangedEvent = GatewayBillingEventBase & {
  type: "subscription_state_changed";
  external_reference: string;
  external_customer_reference: string;
  external_price_reference: string | null;
  status: GatewaySubscriptionStatus;
  current_period_end: Date | null;
  trial_end: Date | null;
};

/** Cancellation effective on the gateway's side. */
export type SubscriptionEndedEvent = GatewayBillingEventBase & {
  type: "subscription_ended";
  external_reference: string;
  external_customer_reference: string;
};

/** Carries the decline reason — never derived from `subscription_state_changed` (§2.6, DA-9). */
export type PaymentFailedEvent = GatewayBillingEventBase & {
  type: "payment_failed";
  external_reference: string;
  external_customer_reference: string;
  reason: string | null;
};

/**
 * Union discriminated on `type`, entirely in Sogio vocabulary — the
 * orchestrator's `switch` never sees a gateway-vendor type string (DA-1).
 */
export type GatewayBillingEvent =
  | CheckoutCompletedEvent
  | SubscriptionStateChangedEvent
  | SubscriptionEndedEvent
  | PaymentFailedEvent;
