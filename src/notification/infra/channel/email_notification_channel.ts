import type { EmailService } from "../../../core/application/email/email_service";
import type { Notification } from "../../domain/entity/notification";
import type {
  NotificationChannel,
  NotificationRecipient,
} from "../../domain/service/notification_channel";

export class EmailNotificationChannel implements NotificationChannel {
  readonly key = "email" as const;

  constructor(private readonly emailService: EmailService) {}

  async deliver(
    notification: Notification,
    recipient: NotificationRecipient
  ): Promise<void> {
    await this.emailService.send({
      to: recipient.email,
      subject: notification.title,
      text: `Olá, ${recipient.name}.\n\n${notification.body}\n\n— Sogio`,
    });
  }
}
