import type { Locale } from "../../../core/domain/locale/locale";
import type { Notification } from "../entity/notification";
import type {
  NotificationChannelKey,
  NotificationContent,
} from "../notification_type/notification_type_registry";

export type NotificationRecipient = {
  user_id: string;
  name: string;
  email: string;
  locale: Locale;
  time_zone: string;
};

export interface NotificationChannel {
  readonly key: NotificationChannelKey;
  /**
   * `content` chega pronto, já no idioma do destinatário: o canal é
   * transporte e nunca decide o que a notificação diz.
   */
  deliver(
    notification: Notification,
    recipient: NotificationRecipient,
    content: NotificationContent
  ): Promise<void>;
}
