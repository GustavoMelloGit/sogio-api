import type { SubscriptionPaymentFailedEvent } from "../../../billing/domain/event/subscription_payment_failed_event";
import type { EventHandler } from "../../../core/application/event/event_handler";
import type { Logger } from "../../../core/application/logger/logger";
import type { NotificationService } from "../service/notification_service";

export class NotifyOnSubscriptionPaymentFailed
  implements EventHandler<SubscriptionPaymentFailedEvent>
{
  constructor(
    private readonly logger: Logger,
    private readonly notificationService: NotificationService
  ) {}

  async handle(event: SubscriptionPaymentFailedEvent): Promise<void> {
    try {
      await this.notificationService.notify({
        user_id: event.user_id,
        type: "subscription_payment_failed",
        payload: { grace_period_ends_at: event.grace_period_ends_at },
      });
    } catch (error) {
      this.logger.error("Failed to enqueue payment failure notification", {
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
