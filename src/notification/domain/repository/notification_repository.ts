import type {
  PaginatedResult,
  PaginationInput,
} from "../../../core/application/dto/pagination";
import type { Notification } from "../entity/notification";
import type { NotificationRecipient } from "../service/notification_channel";

export type ClaimedNotification = {
  notification: Notification;
  recipient: NotificationRecipient;
};

export type NotificationInbox = PaginatedResult<Notification> & {
  unread_count: number;
};

export interface NotificationRepository {
  save(notification: Notification): Promise<void>;
  saveMany(notifications: Notification[]): Promise<void>;
  claimDue(limit: number, now: Date): Promise<ClaimedNotification[]>;
  notificationOfId(id: string): Promise<Notification | null>;
  markInboxReadOfUser(userId: string): Promise<number>;
  inboxOfUser(
    userId: string,
    pagination: PaginationInput
  ): Promise<NotificationInbox>;
}
