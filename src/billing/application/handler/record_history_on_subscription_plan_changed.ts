import type { EventHandler } from "../../../core/application/event/event_handler";
import type { SubscriptionPlanChangedEvent } from "../../domain/event/subscription_plan_changed_event";
import type { RecordSubscriptionHistoryEntryUseCase } from "../use_case/record_subscription_history_entry";
import { deriveAccessUntil } from "./derive_access_until";

export class RecordHistoryOnSubscriptionPlanChanged
  implements EventHandler<SubscriptionPlanChangedEvent>
{
  constructor(
    private readonly recordSubscriptionHistoryEntryUseCase: RecordSubscriptionHistoryEntryUseCase
  ) {}

  async handle(event: SubscriptionPlanChangedEvent): Promise<void> {
    await this.recordSubscriptionHistoryEntryUseCase.execute({
      subscription_id: event.subscription_id,
      user_id: event.user_id,
      plan_id: event.plan_id,
      type: "plan_changed",
      resulting_status: event.status,
      occurred_at: event.occurred_at,
      access_until: deriveAccessUntil(
        event.status,
        event.trial_ends_at,
        event.current_period_end
      ),
    });
  }
}
