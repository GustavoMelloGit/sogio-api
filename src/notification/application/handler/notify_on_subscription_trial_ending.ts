import type { SubscriptionTrialEndingEvent } from "../../../billing/domain/event/subscription_trial_ending_event";
import type { EventHandler } from "../../../core/application/event/event_handler";
import type { Logger } from "../../../core/application/logger/logger";
import type { NotificationService } from "../service/notification_service";

const DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

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
        title: "Seu período de teste está acabando",
        body: `Seu período de teste termina em ${DATE_FORMATTER.format(event.trial_ends_at)}. Escolha um plano para continuar com acesso à plataforma.`,
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
