import type { SubscriptionHistoryEntry } from "../entity/subscription_history_entry";
import type {
  PaginatedResult,
  PaginationInput,
} from "../../../core/application/dto/pagination";

export type SubscriptionHistoryEntryWithPlan = {
  entry: SubscriptionHistoryEntry;
  plan_code: string;
  plan_name: string;
};

export interface SubscriptionHistoryRepository {
  append(entry: SubscriptionHistoryEntry): Promise<void>;
  historyOfUser(
    user_id: string,
    pagination: PaginationInput
  ): Promise<PaginatedResult<SubscriptionHistoryEntryWithPlan>>;
}
