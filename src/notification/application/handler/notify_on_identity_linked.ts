import type { IdentityLinkedEvent } from "../../../auth/domain/event/identity_linked_event";
import type { EventHandler } from "../../../core/application/event/event_handler";
import type { Logger } from "../../../core/application/logger/logger";
import type { NotificationService } from "../service/notification_service";

export class NotifyOnIdentityLinked
  implements EventHandler<IdentityLinkedEvent>
{
  constructor(
    private readonly logger: Logger,
    private readonly notificationService: NotificationService
  ) {}

  async handle(event: IdentityLinkedEvent): Promise<void> {
    try {
      await this.notificationService.notify({
        user_id: event.user_id,
        type: "identity_linked",
        payload: { provider: event.provider },
      });
    } catch (error) {
      this.logger.error("Failed to enqueue identity linked notification", {
        user_id: event.user_id,
        provider: event.provider,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : String(error),
      });
    }
  }
}
