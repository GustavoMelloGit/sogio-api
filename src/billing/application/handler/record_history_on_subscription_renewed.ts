import type { EventHandler } from "../../../core/application/event/event_handler";
import type { SubscriptionRenewedEvent } from "../../domain/event/subscription_renewed_event";
import type { RecordSubscriptionHistoryEntryUseCase } from "../use_case/record_subscription_history_entry";

export class RecordHistoryOnSubscriptionRenewed
  implements EventHandler<SubscriptionRenewedEvent>
{
  constructor(
    private readonly recordSubscriptionHistoryEntryUseCase: RecordSubscriptionHistoryEntryUseCase
  ) {}

  async handle(event: SubscriptionRenewedEvent): Promise<void> {
    await this.recordSubscriptionHistoryEntryUseCase.execute({
      subscription_id: event.subscription_id,
      user_id: event.user_id,
      plan_id: event.plan_id,
      type: "renewed",
      resulting_status: "active",
      occurred_at: event.occurred_at,
      access_until: event.current_period_end,
    });
  }
}
