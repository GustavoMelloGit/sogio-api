import type { User } from "../../../auth/domain/entity/user";
import type { UseCase } from "../../../core/application/use_case/use_case";
import { ResourceNotFoundError } from "../../../core/application/error/resource_not_found_error";
import type { NotificationRepository } from "../../domain/repository/notification_repository";

type Input = {
  notification_id: string;
};

type Output = {
  id: string;
  read_at: Date;
};

export class MarkNotificationReadUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly notificationRepository: NotificationRepository
  ) {}

  async execute(input: Input, user: User): Promise<Output> {
    const notification = await this.notificationRepository.notificationOfId(
      input.notification_id
    );

    if (
      !notification ||
      notification.user_id !== user.id ||
      notification.status !== "sent"
    ) {
      throw new ResourceNotFoundError("Notification");
    }

    notification.markRead();
    await this.notificationRepository.save(notification);

    return { id: notification.id, read_at: notification.read_at! };
  }
}
