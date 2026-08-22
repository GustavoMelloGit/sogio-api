import type { Logger } from "../../../core/application/logger/logger";
import { Notification } from "../../domain/entity/notification";
import type { NotificationPreference } from "../../domain/entity/notification_preference";
import type { NotificationPreferenceRepository } from "../../domain/repository/notification_preference_repository";
import type { NotificationRepository } from "../../domain/repository/notification_repository";
import {
  notificationTypeEntryOf,
  type NotificationChannelKey,
} from "../../domain/notification_type/notification_type_registry";
import type { NotificationService, NotifyInput } from "./notification_service";

export class PersistingNotificationService implements NotificationService {
  constructor(
    private readonly logger: Logger,
    private readonly notificationRepository: NotificationRepository,
    private readonly preferenceRepository: NotificationPreferenceRepository
  ) {}

  async notify(input: NotifyInput): Promise<void> {
    const entry = notificationTypeEntryOf(input.type);

    if (!entry) {
      this.logger.error("Refusing to notify: unknown notification type", {
        type: input.type,
        user_id: input.user_id,
      });
      return;
    }

    const preferences = await this.preferenceRepository.allOfUser(
      input.user_id
    );

    const channels = entry.default_channels.filter(channel =>
      this.#isEnabled(preferences, entry.optional, input.type, channel)
    );

    if (channels.length === 0) {
      return;
    }

    const notifications = channels.map(channel =>
      Notification.create({
        user_id: input.user_id,
        type: input.type,
        channel,
        title: input.title,
        body: input.body,
        scheduled_for: input.scheduled_for ?? null,
      })
    );

    await this.notificationRepository.saveMany(notifications);
  }

  #isEnabled(
    preferences: NotificationPreference[],
    optional: boolean,
    type: string,
    channel: NotificationChannelKey
  ): boolean {
    if (!optional) {
      return true;
    }

    const preference = preferences.find(
      candidate => candidate.type === type && candidate.channel === channel
    );

    return preference?.enabled ?? true;
  }
}
