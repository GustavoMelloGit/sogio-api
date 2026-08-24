import type { User } from "../../../auth/domain/entity/user";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { Logger } from "../../../core/application/logger/logger";
import type {
  PaginatedResult,
  PaginationInput,
} from "../../../core/application/dto/pagination";
import type { NotificationRepository } from "../../domain/repository/notification_repository";
import type { NotificationContentRenderer } from "../../domain/service/notification_content_renderer";

type Input = {
  pagination: PaginationInput;
};

type NotificationListItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  created_at: Date;
  read_at: Date | null;
};

type Output = PaginatedResult<NotificationListItem> & {
  unread_count: number;
};

export class ListNotificationsUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly logger: Logger,
    private readonly notificationRepository: NotificationRepository,
    private readonly contentRenderer: NotificationContentRenderer
  ) {}

  async execute(input: Input, user: User): Promise<Output> {
    const inbox = await this.notificationRepository.inboxOfUser(
      user.id,
      input.pagination
    );

    const data: NotificationListItem[] = [];

    for (const notification of inbox.data) {
      const content = this.contentRenderer.render(
        notification.type,
        notification.payload,
        user.locale,
        user.time_zone
      );

      if (!content) {
        this.logger.warn("Notification content could not be rendered", {
          notification_id: notification.id,
          type: notification.type,
        });
        continue;
      }

      data.push({
        id: notification.id,
        type: notification.type,
        title: content.title,
        body: content.body,
        created_at: notification.created_at,
        read_at: notification.read_at,
      });
    }

    return {
      data,
      pagination: inbox.pagination,
      unread_count: inbox.unread_count,
    };
  }
}
