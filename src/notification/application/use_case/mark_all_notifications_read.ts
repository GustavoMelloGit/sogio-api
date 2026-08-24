import type { User } from "../../../auth/domain/entity/user";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { NotificationRepository } from "../../domain/repository/notification_repository";

type Input = Record<string, never>;

type Output = {
  marked_as_read: number;
};

export class MarkAllNotificationsReadUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly notificationRepository: NotificationRepository
  ) {}

  async execute(_input: Input, user: User): Promise<Output> {
    const markedAsRead = await this.notificationRepository.markInboxReadOfUser(
      user.id
    );

    return { marked_as_read: markedAsRead };
  }
}
