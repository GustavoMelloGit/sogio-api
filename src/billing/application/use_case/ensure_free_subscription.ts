import type { UseCase } from "../../../core/application/use_case/use_case";
import { ResourceNotFoundError } from "../../../core/application/error/resource_not_found_error";
import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import type { PlanRepository } from "../../domain/repository/plan_repository";
import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";
import { Subscription } from "../../domain/entity/subscription";
import { SubscriptionStartedEvent } from "../../domain/event/subscription_started_event";

const FREE_PLAN_CODE = "free";

type Input = {
  user_id: string;
};

type Output = void;

/**
 * Idempotent: safe to call again for a user who already has a subscription.
 * `SubscriptionStartedEvent` is only dispatched inside the branch that
 * actually creates the subscription — never before the early return — so
 * every caller (handler, future backfill, test) inherits exactly-once
 * semantics for free (§2.4).
 */
export class EnsureFreeSubscriptionUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly planRepository: PlanRepository,
    private readonly eventDispatcher: EventDispatcher
  ) {}

  async execute(input: Input): Promise<Output> {
    const existing = await this.subscriptionRepository.subscriptionOfUser(
      input.user_id
    );
    if (existing) return;

    const freePlan = await this.planRepository.planOfCode(FREE_PLAN_CODE);
    if (!freePlan) {
      throw new ResourceNotFoundError("Plan");
    }

    const subscription = Subscription.create({
      user_id: input.user_id,
      plan_id: freePlan.id,
      trial_days: freePlan.trial_days,
      is_perpetual: freePlan.is_perpetual,
      billing_interval: freePlan.billing_interval,
    });

    await this.subscriptionRepository.save(subscription);

    await this.eventDispatcher.dispatch(
      new SubscriptionStartedEvent({
        subscription_id: subscription.id,
        user_id: subscription.user_id,
        plan_id: subscription.plan_id,
        status: subscription.status,
        trial_ends_at: subscription.trial_ends_at,
        current_period_end: subscription.current_period_end,
        opens_paid_cycle: subscription.has_paid_cycle,
      })
    );
  }
}
