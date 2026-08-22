import type { Notification } from "../entity/notification";
import type { NotificationChannelKey } from "../notification_type/notification_type_registry";

export type NotificationRecipient = {
  user_id: string;
  name: string;
  email: string;
};

export interface NotificationChannel {
  readonly key: NotificationChannelKey;
  deliver(
    notification: Notification,
    recipient: NotificationRecipient
  ): Promise<void>;
}
