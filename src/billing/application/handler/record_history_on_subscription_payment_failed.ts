import type { EventHandler } from "../../../core/application/event/event_handler";
import type { SubscriptionPaymentFailedEvent } from "../../domain/event/subscription_payment_failed_event";
import type { RecordSubscriptionHistoryEntryUseCase } from "../use_case/record_subscription_history_entry";

export class RecordHistoryOnSubscriptionPaymentFailed
  implements EventHandler<SubscriptionPaymentFailedEvent>
{
  constructor(
    private readonly recordSubscriptionHistoryEntryUseCase: RecordSubscriptionHistoryEntryUseCase
  ) {}

  async handle(event: SubscriptionPaymentFailedEvent): Promise<void> {
    await this.recordSubscriptionHistoryEntryUseCase.execute({
      subscription_id: event.subscription_id,
      user_id: event.user_id,
      plan_id: event.plan_id,
      type: "payment_failed",
      resulting_status: "past_due",
      occurred_at: event.occurred_at,
      access_until: event.grace_period_ends_at,
      reason: event.reason,
    });
  }
}
