import type { UseCase } from "../../../core/application/use_case/use_case";
import type { Logger } from "../../../core/application/logger/logger";
import { SubscriptionHistoryEntry } from "../../domain/entity/subscription_history_entry";
import type { SubscriptionHistoryEntryType } from "../../domain/entity/subscription_history_entry";
import type { SubscriptionStatus } from "../../domain/entity/subscription";
import type { SubscriptionHistoryRepository } from "../../domain/repository/subscription_history_repository";

type Input = {
  subscription_id: string;
  user_id: string;
  plan_id: string;
  type: SubscriptionHistoryEntryType;
  resulting_status: SubscriptionStatus;
  occurred_at: Date;
  access_until: Date | null;
  reason?: string | null;
};

type Output = void;

/**
 * The single writer of the subscription history (DA-2). Deliberately does
 * NOT propagate a failure to append: the business transition it audits has
 * already been committed by the time this runs, so a broken write here must
 * not turn a successful signup/plan-change/cancellation into a 500.
 */
export class RecordSubscriptionHistoryEntryUseCase
  implements UseCase<Input, Output>
{
  constructor(
    private readonly logger: Logger,
    private readonly subscriptionHistoryRepository: SubscriptionHistoryRepository
  ) {}

  async execute(input: Input): Promise<Output> {
    try {
      const entry = SubscriptionHistoryEntry.record({
        subscription_id: input.subscription_id,
        user_id: input.user_id,
        plan_id: input.plan_id,
        type: input.type,
        resulting_status: input.resulting_status,
        occurred_at: input.occurred_at,
        access_until: input.access_until,
        reason: input.reason ?? null,
      });

      await this.subscriptionHistoryRepository.append(entry);
    } catch (error) {
      this.logger.error("Failed to record subscription history entry", {
        subscription_id: input.subscription_id,
        type: input.type,
        occurred_at: input.occurred_at,
        error,
      });
    }
  }
}
