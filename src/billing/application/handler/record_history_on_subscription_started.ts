import type { EventHandler } from "../../../core/application/event/event_handler";
import type { SubscriptionStartedEvent } from "../../domain/event/subscription_started_event";
import type { RecordSubscriptionHistoryEntryUseCase } from "../use_case/record_subscription_history_entry";
import { AccessUntilPolicy } from "../../domain/policy/access_until_policy";

export class RecordHistoryOnSubscriptionStarted
  implements EventHandler<SubscriptionStartedEvent>
{
  constructor(
    private readonly recordSubscriptionHistoryEntryUseCase: RecordSubscriptionHistoryEntryUseCase
  ) {}

  async handle(event: SubscriptionStartedEvent): Promise<void> {
    await this.recordSubscriptionHistoryEntryUseCase.execute({
      subscription_id: event.subscription_id,
      user_id: event.user_id,
      plan_id: event.plan_id,
      type: "started",
      resulting_status: event.status,
      occurred_at: event.occurred_at,
      access_until: AccessUntilPolicy.resolve(
        event.status,
        event.trial_ends_at,
        event.current_period_end
      ),
    });
  }
}
