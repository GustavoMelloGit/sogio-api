import type { NotificationTypeKey } from "../../domain/notification_type/notification_type_registry";

export type NotifyInput = {
  user_id: string;
  type: NotificationTypeKey;
  title: string;
  body: string;
  scheduled_for?: Date | null;
};

export interface NotificationService {
  notify(input: NotifyInput): Promise<void>;
}
