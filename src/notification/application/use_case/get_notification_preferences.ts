import type { User } from "../../../auth/domain/entity/user";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { NotificationPreferenceRepository } from "../../domain/repository/notification_preference_repository";
import {
  NOTIFICATION_TYPE_REGISTRY,
  type NotificationChannelKey,
  type NotificationTypeKey,
} from "../../domain/notification_type/notification_type_registry";

type Output = {
  preferences: Array<{
    type: NotificationTypeKey;
    label: string;
    optional: boolean;
    channels: Array<{
      channel: NotificationChannelKey;
      enabled: boolean;
    }>;
  }>;
};

export class GetNotificationPreferencesUseCase
  implements UseCase<void, Output>
{
  constructor(
    private readonly preferenceRepository: NotificationPreferenceRepository
  ) {}

  async execute(_input: void, user: User): Promise<Output> {
    const stored = await this.preferenceRepository.allOfUser(user.id);

    return {
      preferences: NOTIFICATION_TYPE_REGISTRY.map(entry => ({
        type: entry.key,
        label: entry.label[user.locale],
        optional: entry.optional,
        channels: entry.default_channels.map(channel => ({
          channel,
          enabled: entry.optional
            ? (stored.find(
                preference =>
                  preference.type === entry.key &&
                  preference.channel === channel
              )?.enabled ?? true)
            : true,
        })),
      })),
    };
  }
}
