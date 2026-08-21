import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../../auth/domain/entity/user";
import type { SubscriptionHistoryRepository } from "../../domain/repository/subscription_history_repository";
import type {
  PaginatedResult,
  PaginationInput,
} from "../../../core/application/dto/pagination";
import type { SubscriptionHistoryEntryType } from "../../domain/entity/subscription_history_entry";
import type { SubscriptionStatus } from "../../domain/entity/subscription";

type Input = {
  pagination: PaginationInput;
};

type Output = PaginatedResult<{
  id: string;
  type: SubscriptionHistoryEntryType;
  resulting_status: SubscriptionStatus;
  plan_id: string;
  plan_code: string;
  plan_name: string;
  occurred_at: Date;
  access_until: Date | null;
  reason: string | null;
}>;

export class GetSubscriptionHistoryUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly subscriptionHistoryRepository: SubscriptionHistoryRepository
  ) {}

  async execute(input: Input, user: User): Promise<Output> {
    const result = await this.subscriptionHistoryRepository.historyOfUser(
      user.id,
      input.pagination
    );

    return {
      pagination: result.pagination,
      data: result.data.map(({ entry, plan_code, plan_name }) => ({
        id: entry.id,
        type: entry.type,
        resulting_status: entry.resulting_status,
        plan_id: entry.plan_id,
        plan_code,
        plan_name,
        occurred_at: entry.occurred_at,
        access_until: entry.access_until,
        reason: entry.reason,
      })),
    };
  }
}
