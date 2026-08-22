import type { NotificationPreference } from "../entity/notification_preference";

export interface NotificationPreferenceRepository {
  allOfUser(userId: string): Promise<NotificationPreference[]>;
  save(preference: NotificationPreference): Promise<void>;
}
