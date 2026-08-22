import type { EmailService } from "../../../core/application/email/email_service";
import type { Locale } from "../../../core/domain/locale/locale";
import type { Notification } from "../../domain/entity/notification";
import type { NotificationContent } from "../../domain/notification_type/notification_type_registry";
import type {
  NotificationChannel,
  NotificationRecipient,
} from "../../domain/service/notification_channel";

const ENVELOPE: Record<Locale, (name: string, body: string) => string> = {
  "pt-BR": (name, body) => `Olá, ${name}.\n\n${body}\n\n— Sogio`,
  "en-US": (name, body) => `Hi ${name},\n\n${body}\n\n— Sogio`,
};

export class EmailNotificationChannel implements NotificationChannel {
  readonly key = "email" as const;

  constructor(private readonly emailService: EmailService) {}

  async deliver(
    _notification: Notification,
    recipient: NotificationRecipient,
    content: NotificationContent
  ): Promise<void> {
    await this.emailService.send({
      to: recipient.email,
      subject: content.title,
      text: ENVELOPE[recipient.locale](recipient.name, content.body),
    });
  }
}
