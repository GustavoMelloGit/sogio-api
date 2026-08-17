import type { DomainEvent } from "../../../core/domain/event/domain_event";

type SubscriptionPaymentFailedEventInput = {
  subscription_id: string;
  user_id: string;
  plan_id: string;
  grace_period_ends_at: Date;
  reason: string | null;
};

export class SubscriptionPaymentFailedEvent implements DomainEvent {
  static readonly NAME = "subscription_payment_failed";
  public readonly name: string;
  public readonly occurred_at: Date;
  public readonly subscription_id: string;
  public readonly user_id: string;
  public readonly plan_id: string;
  public readonly grace_period_ends_at: Date;
  public readonly reason: string | null;

  constructor(input: SubscriptionPaymentFailedEventInput) {
    this.name = SubscriptionPaymentFailedEvent.NAME;
    this.occurred_at = new Date();
    this.subscription_id = input.subscription_id;
    this.user_id = input.user_id;
    this.plan_id = input.plan_id;
    this.grace_period_ends_at = input.grace_period_ends_at;
    this.reason = input.reason;
  }
}
