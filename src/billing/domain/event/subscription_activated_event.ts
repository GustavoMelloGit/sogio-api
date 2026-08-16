import type { DomainEvent } from "../../../core/domain/event/domain_event";

export class SubscriptionActivatedEvent implements DomainEvent {
  static readonly NAME = "subscription_activated";
  public readonly name: string;
  public readonly occurred_at: Date;

  constructor(
    public readonly subscription_id: string,
    public readonly user_id: string,
    public readonly plan_id: string
  ) {
    this.name = SubscriptionActivatedEvent.NAME;
    this.occurred_at = new Date();
  }
}
