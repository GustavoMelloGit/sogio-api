import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../../auth/domain/entity/user";
import { ResourceNotFoundError } from "../../../core/application/error/resource_not_found_error";
import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import type { PlanRepository } from "../../domain/repository/plan_repository";
import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";
import type { SubscriptionStatus } from "../../domain/entity/subscription";
import { SubscriptionCanceledEvent } from "../../domain/event/subscription_canceled_event";

type Input = Record<string, never>;

type Output = {
  id: string;
  status: SubscriptionStatus;
  canceled_at: Date | null;
};

/** Canceling a perpetual (Free) plan is rejected by `Subscription.cancel`. */
export class CancelSubscriptionUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly planRepository: PlanRepository,
    private readonly eventDispatcher: EventDispatcher
  ) {}

  async execute(_input: Input, user: User): Promise<Output> {
    const subscription = await this.subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) {
      throw new ResourceNotFoundError("Subscription");
    }

    const plan = await this.planRepository.planOfId(subscription.plan_id);
    if (!plan) {
      throw new ResourceNotFoundError("Plan");
    }

    subscription.cancel({ is_perpetual: plan.is_perpetual });
    await this.subscriptionRepository.save(subscription);

    await this.eventDispatcher.dispatch(
      new SubscriptionCanceledEvent(subscription.id, user.id, plan.id)
    );

    return {
      id: subscription.id,
      status: subscription.status,
      canceled_at: subscription.canceled_at,
    };
  }
}
