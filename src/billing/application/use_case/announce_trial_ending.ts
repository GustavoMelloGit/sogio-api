import type { UseCase } from "../../../core/application/use_case/use_case";
import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import type { Logger } from "../../../core/application/logger/logger";
import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";
import { SubscriptionTrialEndingEvent } from "../../domain/event/subscription_trial_ending_event";

type Input = {
  user_id: string;
  trial_ends_at: Date | null;
};

export class AnnounceTrialEndingUseCase implements UseCase<Input, void> {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly eventDispatcher: EventDispatcher,
    private readonly logger: Logger
  ) {}

  async execute(input: Input): Promise<void> {
    const subscription = await this.subscriptionRepository.subscriptionOfUser(
      input.user_id
    );

    if (!subscription) {
      return;
    }

    if (subscription.status !== "trialing") {
      this.logger.info(
        "trial_will_end for a subscription no longer trialing — nothing to announce",
        { subscription_id: subscription.id, status: subscription.status }
      );
      return;
    }

    const trialEndsAt = input.trial_ends_at ?? subscription.trial_ends_at;

    if (!trialEndsAt) {
      this.logger.info(
        "trial_will_end without a trial end date — nothing to announce",
        { subscription_id: subscription.id }
      );
      return;
    }

    await this.eventDispatcher.dispatch(
      new SubscriptionTrialEndingEvent({
        subscription_id: subscription.id,
        user_id: subscription.user_id,
        plan_id: subscription.plan_id,
        trial_ends_at: trialEndsAt,
      })
    );
  }
}
