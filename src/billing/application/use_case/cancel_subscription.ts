import type { UseCase } from "../../../core/application/use_case/use_case";
import { ResourceNotFoundError } from "../../../core/application/error/resource_not_found_error";
import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import type { PlanRepository } from "../../domain/repository/plan_repository";
import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";
import type { SubscriptionStatus } from "../../domain/entity/subscription";
import { SubscriptionCanceledEvent } from "../../domain/event/subscription_canceled_event";

type Input = {
  user_id: string;
};

type Output = {
  id: string;
  status: SubscriptionStatus;
  canceled_at: Date | null;
};

/**
 * Canceling a perpetual (Free) plan is rejected by `Subscription.cancel`.
 * `Input` is `{ user_id }` rather than reading the caller off `User`
 * (DA-10) — the same shape as `MarkSubscriptionPastDueUseCase` — so the
 * webhook's `subscription_ended` path can reuse this use case directly
 * instead of reimplementing the transition. No HTTP route of its own:
 * cancellation for a real user always goes through the billing portal.
 *
 * Idempotent (§2.4 rule 2): calling this on an already-canceled
 * subscription is a silent no-op — `Subscription.cancel` doesn't throw, and
 * this use case doesn't publish a second `SubscriptionCanceledEvent`, so a
 * webhook reentry of `customer.subscription.deleted` never double-writes
 * the history.
 */
export class CancelSubscriptionUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly planRepository: PlanRepository,
    private readonly eventDispatcher: EventDispatcher
  ) {}

  async execute(input: Input): Promise<Output> {
    const subscription = await this.subscriptionRepository.subscriptionOfUser(
      input.user_id
    );
    if (!subscription) {
      throw new ResourceNotFoundError("Subscription");
    }

    const plan = await this.planRepository.planOfId(subscription.plan_id);
    if (!plan) {
      throw new ResourceNotFoundError("Plan");
    }

    const wasAlreadyCanceled = subscription.status === "canceled";

    subscription.cancel({ is_perpetual: plan.is_perpetual });
    await this.subscriptionRepository.save(subscription);

    if (!wasAlreadyCanceled) {
      await this.eventDispatcher.dispatch(
        new SubscriptionCanceledEvent(
          subscription.id,
          subscription.user_id,
          plan.id,
          subscription.current_period_end
        )
      );
    }

    return {
      id: subscription.id,
      status: subscription.status,
      canceled_at: subscription.canceled_at,
    };
  }
}
