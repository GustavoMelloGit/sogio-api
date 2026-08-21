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
  event_id: string;

  occurred_at: Date;
};

export type CheckoutCompletedEvent = GatewayBillingEventBase & {
  type: "checkout_completed";
  user_id: string;
  external_customer_reference: string;
  external_reference: string | null;
};

export type SubscriptionStateChangedEvent = GatewayBillingEventBase & {
  type: "subscription_state_changed";
  external_reference: string;
  external_customer_reference: string;
  external_price_reference: string | null;
  status: GatewaySubscriptionStatus;
  current_period_end: Date | null;
  trial_end: Date | null;
};

export type SubscriptionEndedEvent = GatewayBillingEventBase & {
  type: "subscription_ended";
  external_reference: string;
  external_customer_reference: string;
};

export type PaymentFailedEvent = GatewayBillingEventBase & {
  type: "payment_failed";
  external_reference: string;
  external_customer_reference: string;
  reason: string | null;
};

export type GatewayBillingEvent =
  | CheckoutCompletedEvent
  | SubscriptionStateChangedEvent
  | SubscriptionEndedEvent
  | PaymentFailedEvent;
