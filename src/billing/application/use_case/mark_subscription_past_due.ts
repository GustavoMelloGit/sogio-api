import type { UseCase } from "../../../core/application/use_case/use_case";
import { ResourceNotFoundError } from "../../../core/application/error/resource_not_found_error";
import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";
import type { SubscriptionStatus } from "../../domain/entity/subscription";
import { BillingCyclePolicy } from "../../domain/policy/billing_cycle_policy";
import { SubscriptionPaymentFailedEvent } from "../../domain/event/subscription_payment_failed_event";

type Input = {
  user_id: string;
  reason?: string | null;
  now?: Date;
};

type Output = {
  id: string;
  status: SubscriptionStatus;
  grace_period_ends_at: Date | null;
};

/**
 * The real caller `markPastDue` was missing (DA-5) — this is the shape a
 * future Stripe payment-failure webhook will invoke. No HTTP route: marking
 * an account past due by hand is an operational lever, not a product surface.
 */
export class MarkSubscriptionPastDueUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly eventDispatcher: EventDispatcher
  ) {}

  async execute(input: Input): Promise<Output> {
    const subscription = await this.subscriptionRepository.subscriptionOfUser(
      input.user_id
    );
    if (!subscription) {
      throw new ResourceNotFoundError("Subscription");
    }

    const now = input.now ?? new Date();
    const gracePeriodEndsAt = BillingCyclePolicy.gracePeriodEnd(now);

    subscription.markPastDue(gracePeriodEndsAt);
    await this.subscriptionRepository.save(subscription);

    await this.eventDispatcher.dispatch(
      new SubscriptionPaymentFailedEvent({
        subscription_id: subscription.id,
        user_id: subscription.user_id,
        plan_id: subscription.plan_id,
        grace_period_ends_at: gracePeriodEndsAt,
        reason: input.reason ?? null,
      })
    );

    return {
      id: subscription.id,
      status: subscription.status,
      grace_period_ends_at: subscription.grace_period_ends_at,
    };
  }
}
