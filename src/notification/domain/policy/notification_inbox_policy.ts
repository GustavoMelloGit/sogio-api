import type { Notification, NotificationStatus } from "../entity/notification";
import { NOTIFICATION_TYPE_KEYS } from "../notification_type/notification_type_registry";

export class NotificationInboxPolicy {
  static readonly DELIVERED_STATUS: NotificationStatus = "sent";
  static readonly PENDING_DELIVERY_STATUS: NotificationStatus = "pending";
  static readonly RENDERABLE_TYPES = NOTIFICATION_TYPE_KEYS;

  static belongsToInbox(notification: Notification): boolean {
    return (
      notification.status === this.DELIVERED_STATUS &&
      !notification.deleted_at &&
      (this.RENDERABLE_TYPES as readonly string[]).includes(notification.type)
    );
  }

  static isUnread(notification: Notification): boolean {
    return this.belongsToInbox(notification) && notification.read_at === null;
  }
}
