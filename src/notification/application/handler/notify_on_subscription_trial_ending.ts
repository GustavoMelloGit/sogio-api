import type { SubscriptionTrialEndingEvent } from "../../../billing/domain/event/subscription_trial_ending_event";
import type { EventHandler } from "../../../core/application/event/event_handler";
import type { Logger } from "../../../core/application/logger/logger";
import type { NotificationService } from "../service/notification_service";

export class NotifyOnSubscriptionTrialEnding
  implements EventHandler<SubscriptionTrialEndingEvent>
{
  constructor(
    private readonly logger: Logger,
    private readonly notificationService: NotificationService
  ) {}

  async handle(event: SubscriptionTrialEndingEvent): Promise<void> {
    try {
      await this.notificationService.notify({
        user_id: event.user_id,
        type: "subscription_trial_ending",
        payload: { trial_ends_at: event.trial_ends_at },
      });
    } catch (error) {
      this.logger.error("Failed to enqueue trial ending notification", {
        user_id: event.user_id,
        subscription_id: event.subscription_id,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : String(error),
      });
    }
  }
}
