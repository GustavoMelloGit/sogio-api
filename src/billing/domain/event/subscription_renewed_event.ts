import type { DomainEvent } from "../../../core/domain/event/domain_event";

type SubscriptionRenewedEventInput = {
  subscription_id: string;
  user_id: string;
  plan_id: string;
  current_period_end: Date | null;
};

/**
 * A new paid cycle opened without a plan switch (§2.6, the R-7 follow-up
 * from the previous entry). Only `SyncSubscriptionFromGatewayUseCase`
 * dispatches this — the internal path never renews on its own.
 */
export class SubscriptionRenewedEvent implements DomainEvent {
  static readonly NAME = "subscription_renewed";
  public readonly name: string;
  public readonly occurred_at: Date;
  public readonly subscription_id: string;
  public readonly user_id: string;
  public readonly plan_id: string;
  public readonly current_period_end: Date | null;

  constructor(input: SubscriptionRenewedEventInput) {
    this.name = SubscriptionRenewedEvent.NAME;
    this.occurred_at = new Date();
    this.subscription_id = input.subscription_id;
    this.user_id = input.user_id;
    this.plan_id = input.plan_id;
    this.current_period_end = input.current_period_end;
  }
}
