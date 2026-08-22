import type { DomainEvent } from "../../../core/domain/event/domain_event";

type SubscriptionTrialEndingEventInput = {
  subscription_id: string;
  user_id: string;
  plan_id: string;
  trial_ends_at: Date;
};

export class SubscriptionTrialEndingEvent implements DomainEvent {
  static readonly NAME = "subscription_trial_ending";
  public readonly name: string;
  public readonly occurred_at: Date;
  public readonly subscription_id: string;
  public readonly user_id: string;
  public readonly plan_id: string;
  public readonly trial_ends_at: Date;

  constructor(input: SubscriptionTrialEndingEventInput) {
    this.name = SubscriptionTrialEndingEvent.NAME;
    this.occurred_at = new Date();
    this.subscription_id = input.subscription_id;
    this.user_id = input.user_id;
    this.plan_id = input.plan_id;
    this.trial_ends_at = input.trial_ends_at;
  }
}
