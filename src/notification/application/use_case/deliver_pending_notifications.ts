import type { Logger } from "../../../core/application/logger/logger";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { NotificationChannel } from "../../domain/service/notification_channel";
import type { NotificationRepository } from "../../domain/repository/notification_repository";
import type { NotificationContentRenderer } from "../../domain/service/notification_content_renderer";

type Input = {
  limit: number;
};

type Output = {
  delivered: number;
  failed: number;
};

export class DeliverPendingNotificationsUseCase
  implements UseCase<Input, Output>
{
  readonly #channels: Map<string, NotificationChannel>;

  constructor(
    private readonly logger: Logger,
    private readonly notificationRepository: NotificationRepository,
    private readonly contentRenderer: NotificationContentRenderer,
    channels: NotificationChannel[]
  ) {
    this.#channels = new Map(
      channels.map(channel => [channel.key as string, channel])
    );
  }

  async execute(input: Input): Promise<Output> {
    const claimed = await this.notificationRepository.claimDue(
      input.limit,
      new Date()
    );

    let delivered = 0;
    let failed = 0;

    for (const { notification, recipient } of claimed) {
      const channel = this.#channels.get(notification.channel);

      if (!channel) {
        notification.markFailed(
          `No channel registered: ${notification.channel}`
        );
        await this.notificationRepository.save(notification);
        failed++;
        continue;
      }

      const content = this.contentRenderer.render(
        notification.type,
        notification.payload,
        recipient.locale,
        recipient.time_zone
      );

      if (!content) {
        notification.markFailed(
          `Unrenderable notification: ${notification.type}`
        );
        await this.notificationRepository.save(notification);
        failed++;
        this.logger.error("Notification content could not be rendered", {
          notification_id: notification.id,
          type: notification.type,
          locale: recipient.locale,
        });
        continue;
      }

      try {
        await channel.deliver(notification, recipient, content);
        notification.markSent();
        delivered++;
      } catch (error) {
        notification.markFailed(
          error instanceof Error ? error.message : String(error)
        );
        failed++;
        this.logger.error("Notification delivery failed", {
          notification_id: notification.id,
          channel: notification.channel,
          attempts: notification.attempts,
          status: notification.status,
        });
      }

      await this.notificationRepository.save(notification);
    }

    return { delivered, failed };
  }
}
