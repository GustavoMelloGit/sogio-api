import type { DomainEvent } from "../../../core/domain/event/domain_event";

export class SubscriptionCanceledEvent implements DomainEvent {
  static readonly NAME = "subscription_canceled";
  public readonly name: string;
  public readonly occurred_at: Date;

  constructor(
    public readonly subscription_id: string,
    public readonly user_id: string,
    public readonly plan_id: string
  ) {
    this.name = SubscriptionCanceledEvent.NAME;
    this.occurred_at = new Date();
  }
}
