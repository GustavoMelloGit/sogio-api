import type { UseCase } from "../../../core/application/use_case/use_case";
import { ResourceNotFoundError } from "../../../core/application/error/resource_not_found_error";
import type { PlanRepository } from "../../domain/repository/plan_repository";
import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";
import { Subscription } from "../../domain/entity/subscription";

const FREE_PLAN_CODE = "free";

type Input = {
  user_id: string;
};

type Output = void;

/** Idempotent: safe to call again for a user who already has a subscription. */
export class EnsureFreeSubscriptionUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly planRepository: PlanRepository
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
  }
}
