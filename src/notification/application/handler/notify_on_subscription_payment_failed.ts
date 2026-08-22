import type { SubscriptionPaymentFailedEvent } from "../../../billing/domain/event/subscription_payment_failed_event";
import type { EventHandler } from "../../../core/application/event/event_handler";
import type { Logger } from "../../../core/application/logger/logger";
import type { NotificationService } from "../service/notification_service";

const DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

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
        title: "Falha no pagamento da sua assinatura",
        body: `Não conseguimos processar o pagamento da sua assinatura. Regularize até ${DATE_FORMATTER.format(event.grace_period_ends_at)} para não perder o acesso à plataforma.`,
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
