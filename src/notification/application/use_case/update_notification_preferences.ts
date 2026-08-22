import type { User } from "../../../auth/domain/entity/user";
import type { UseCase } from "../../../core/application/use_case/use_case";
import { ValidationError } from "../../../core/application/error/validation_error";
import { NotificationPreference } from "../../domain/entity/notification_preference";
import type { NotificationPreferenceRepository } from "../../domain/repository/notification_preference_repository";
import {
  isNotificationChannel,
  notificationTypeEntryOf,
  type NotificationChannelKey,
} from "../../domain/notification_type/notification_type_registry";

type Input = {
  type: string;
  channel: string;
  enabled: boolean;
};

type Output = {
  type: string;
  channel: NotificationChannelKey;
  enabled: boolean;
};

export class UpdateNotificationPreferencesUseCase
  implements UseCase<Input, Output>
{
  constructor(
    private readonly preferenceRepository: NotificationPreferenceRepository
  ) {}

  async execute(input: Input, user: User): Promise<Output> {
    const entry = notificationTypeEntryOf(input.type);

    if (!entry) {
      throw new ValidationError(`Unknown notification type: ${input.type}`);
    }

    if (!entry.optional) {
      throw new ValidationError(
        `Notification type ${input.type} cannot be turned off`
      );
    }

    if (!isNotificationChannel(input.channel)) {
      throw new ValidationError(`Unknown channel: ${input.channel}`);
    }

    if (!entry.default_channels.includes(input.channel)) {
      throw new ValidationError(
        `Channel ${input.channel} is not available for ${input.type}`
      );
    }

    const stored = await this.preferenceRepository.allOfUser(user.id);
    const existing = stored.find(
      preference =>
        preference.type === input.type && preference.channel === input.channel
    );

    if (existing) {
      existing.changeTo(input.enabled);
      await this.preferenceRepository.save(existing);
    } else {
      await this.preferenceRepository.save(
        NotificationPreference.create({
          user_id: user.id,
          type: input.type,
          channel: input.channel,
          enabled: input.enabled,
        })
      );
    }

    return {
      type: input.type,
      channel: input.channel,
      enabled: input.enabled,
    };
  }
}
