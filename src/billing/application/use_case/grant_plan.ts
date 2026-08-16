import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../../auth/domain/entity/user";
import { ResourceNotFoundError } from "../../../core/application/error/resource_not_found_error";
import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import type { PlanRepository } from "../../domain/repository/plan_repository";
import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";
import type { SubscriptionStatus } from "../../domain/entity/subscription";
import { SubscriptionPlanChangedEvent } from "../../domain/event/subscription_plan_changed_event";

type Input = {
  plan_code: string;
};

type Output = {
  id: string;
  plan_id: string;
  status: SubscriptionStatus;
  current_period_start: Date | null;
  current_period_end: Date | null;
  trial_ends_at: Date | null;
};

/** Also covers switching plans (DA-5): the subscription is mutated in place. */
export class SubscribeToPlanUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly planRepository: PlanRepository,
    private readonly eventDispatcher: EventDispatcher
  ) {}

  async execute(input: Input, user: User): Promise<Output> {
    const plan = await this.planRepository.planOfCode(input.plan_code);
    // A soft-deleted plan must look nonexistent to whoever tries to subscribe to it.
    if (!plan || plan.deleted_at) {
      throw new ResourceNotFoundError("Plan");
    }

    const subscription = await this.subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) {
      throw new ResourceNotFoundError("Subscription");
    }

    subscription.changePlan({
      plan_id: plan.id,
      trial_days: plan.trial_days,
      is_perpetual: plan.is_perpetual,
      billing_interval: plan.billing_interval,
    });

    await this.subscriptionRepository.save(subscription);

    await this.eventDispatcher.dispatch(
      new SubscriptionPlanChangedEvent({
        subscription_id: subscription.id,
        user_id: user.id,
        plan_id: plan.id,
        status: subscription.status,
        trial_ends_at: subscription.trial_ends_at,
        current_period_end: subscription.current_period_end,
        opens_paid_cycle: subscription.has_paid_cycle,
      })
    );

    return {
      id: subscription.id,
      plan_id: subscription.plan_id,
      status: subscription.status,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
      trial_ends_at: subscription.trial_ends_at,
    };
  }
}
