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

export interface NotificationRepository {
  save(notification: Notification): Promise<void>;
  saveMany(notifications: Notification[]): Promise<void>;
  claimDue(limit: number, now: Date): Promise<ClaimedNotification[]>;
  notificationOfId(id: string): Promise<Notification | null>;
  allOfUser(
    userId: string,
    pagination: PaginationInput
  ): Promise<PaginatedResult<Notification>>;
}
