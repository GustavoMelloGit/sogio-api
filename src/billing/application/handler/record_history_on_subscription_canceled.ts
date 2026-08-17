import type { EventHandler } from "../../../core/application/event/event_handler";
import type { SubscriptionCanceledEvent } from "../../domain/event/subscription_canceled_event";
import type { RecordSubscriptionHistoryEntryUseCase } from "../use_case/record_subscription_history_entry";

export class RecordHistoryOnSubscriptionCanceled
  implements EventHandler<SubscriptionCanceledEvent>
{
  constructor(
    private readonly recordSubscriptionHistoryEntryUseCase: RecordSubscriptionHistoryEntryUseCase
  ) {}

  async handle(event: SubscriptionCanceledEvent): Promise<void> {
    await this.recordSubscriptionHistoryEntryUseCase.execute({
      subscription_id: event.subscription_id,
      user_id: event.user_id,
      plan_id: event.plan_id,
      type: "canceled",
      resulting_status: "canceled",
      occurred_at: event.occurred_at,
      access_until: event.current_period_end,
    });
  }
}
