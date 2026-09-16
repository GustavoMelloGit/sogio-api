import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../../auth/domain/entity/user";
import { ResourceNotFoundError } from "../../../core/application/error/resource_not_found_error";
import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";

type Input = Record<string, never>;

type Output = void;

export class ConfirmFreePlanChoiceUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository
  ) {}

  async execute(_input: Input, user: User): Promise<Output> {
    const subscription = await this.subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) {
      throw new ResourceNotFoundError("Subscription");
    }

    if (!subscription.needs_plan_choice) {
      return;
    }

    await this.subscriptionRepository.recordPlanChoiceIfAbsent(
      subscription.id,
      new Date()
    );
  }
}
