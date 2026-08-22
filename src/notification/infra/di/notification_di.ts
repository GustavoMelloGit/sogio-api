import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import type { Logger } from "../../../core/application/logger/logger";
import { inMemoryEventDispatcher } from "../../../core/infra/event/in_memory_event_dispatcher";
import { CoreDi } from "../../../core/infra/di/core_di";
import { SubscriptionPaymentFailedEvent } from "../../../billing/domain/event/subscription_payment_failed_event";
import { NotifyOnSubscriptionPaymentFailed } from "../../application/handler/notify_on_subscription_payment_failed";
import { PersistingNotificationService } from "../../application/service/persisting_notification_service";
import type { NotificationService } from "../../application/service/notification_service";
import { DeliverPendingNotificationsUseCase } from "../../application/use_case/deliver_pending_notifications";
import { GetNotificationPreferencesUseCase } from "../../application/use_case/get_notification_preferences";
import { UpdateNotificationPreferencesUseCase } from "../../application/use_case/update_notification_preferences";
import type { NotificationRepository } from "../../domain/repository/notification_repository";
import type { NotificationPreferenceRepository } from "../../domain/repository/notification_preference_repository";
import { NotificationPostgresRepository } from "../database/postgres_repository/notification_postgres_repository";
import { NotificationPreferencePostgresRepository } from "../database/postgres_repository/notification_preference_postgres_repository";
import { EmailNotificationChannel } from "../channel/email_notification_channel";
import { GetNotificationPreferencesController } from "../../presentation/controller/get_notification_preferences.controller";
import { UpdateNotificationPreferencesController } from "../../presentation/controller/update_notification_preferences.controller";
import { makeGetNotificationPreferencesTool } from "../../presentation/mcp_tool/get_notification_preferences.mcp_tool";
import { makeUpdateNotificationPreferencesTool } from "../../presentation/mcp_tool/update_notification_preferences.mcp_tool";

export class NotificationDi {
  #logger: Logger;
  #eventDispatcher: EventDispatcher;
  #notificationRepository: NotificationRepository;
  #preferenceRepository: NotificationPreferenceRepository;
  #notificationService: NotificationService;

  constructor() {
    const coreDi = new CoreDi();

    this.#logger = coreDi.makeLogger();
    this.#eventDispatcher = inMemoryEventDispatcher;
    this.#notificationRepository = new NotificationPostgresRepository();
    this.#preferenceRepository = new NotificationPreferencePostgresRepository();
    this.#notificationService = new PersistingNotificationService(
      this.#logger,
      this.#notificationRepository,
      this.#preferenceRepository
    );
  }

  registerEventHandlers(): void {
    this.#eventDispatcher.register(
      SubscriptionPaymentFailedEvent.NAME,
      new NotifyOnSubscriptionPaymentFailed(
        this.#logger,
        this.#notificationService
      )
    );
  }

  makeNotificationService(): NotificationService {
    return this.#notificationService;
  }

  makeDeliverPendingNotificationsUseCase(): DeliverPendingNotificationsUseCase {
    return new DeliverPendingNotificationsUseCase(
      this.#logger,
      this.#notificationRepository,
      [new EmailNotificationChannel(new CoreDi().makeEmailService())]
    );
  }

  makeGetNotificationPreferencesUseCase(): GetNotificationPreferencesUseCase {
    return new GetNotificationPreferencesUseCase(this.#preferenceRepository);
  }

  makeUpdateNotificationPreferencesUseCase(): UpdateNotificationPreferencesUseCase {
    return new UpdateNotificationPreferencesUseCase(this.#preferenceRepository);
  }

  makeGetNotificationPreferencesController(): GetNotificationPreferencesController {
    return new GetNotificationPreferencesController(
      this.makeGetNotificationPreferencesUseCase()
    );
  }

  makeUpdateNotificationPreferencesController(): UpdateNotificationPreferencesController {
    return new UpdateNotificationPreferencesController(
      this.makeUpdateNotificationPreferencesUseCase()
    );
  }

  makeGetNotificationPreferencesTool() {
    return makeGetNotificationPreferencesTool(
      this.makeGetNotificationPreferencesUseCase()
    );
  }

  makeUpdateNotificationPreferencesTool() {
    return makeUpdateNotificationPreferencesTool(
      this.makeUpdateNotificationPreferencesUseCase()
    );
  }
}
