import type { DomainEvent } from "../../../core/domain/event/domain_event";
import type { SubscriptionStatus } from "../entity/subscription";

type SubscriptionStartedEventInput = {
  subscription_id: string;
  user_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  trial_ends_at: Date | null;
  current_period_end: Date | null;
  opens_paid_cycle: boolean;
};

/** Dispatched only when a Subscription is created for the first time — never on an idempotent no-op. */
export class SubscriptionStartedEvent implements DomainEvent {
  static readonly NAME = "subscription_started";
  public readonly name: string;
  public readonly occurred_at: Date;
  public readonly subscription_id: string;
  public readonly user_id: string;
  public readonly plan_id: string;
  public readonly status: SubscriptionStatus;
  public readonly trial_ends_at: Date | null;
  public readonly current_period_end: Date | null;
  public readonly opens_paid_cycle: boolean;

  constructor(input: SubscriptionStartedEventInput) {
    this.name = SubscriptionStartedEvent.NAME;
    this.occurred_at = new Date();
    this.subscription_id = input.subscription_id;
    this.user_id = input.user_id;
    this.plan_id = input.plan_id;
    this.status = input.status;
    this.trial_ends_at = input.trial_ends_at;
    this.current_period_end = input.current_period_end;
    this.opens_paid_cycle = input.opens_paid_cycle;
  }
}
