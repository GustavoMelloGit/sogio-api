import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import type { Logger } from "../../../core/application/logger/logger";
import { inMemoryEventDispatcher } from "../../../core/infra/event/in_memory_event_dispatcher";
import { CoreDi } from "../../../core/infra/di/core_di";
import { SubscriptionPaymentFailedEvent } from "../../../billing/domain/event/subscription_payment_failed_event";
import { SubscriptionTrialEndingEvent } from "../../../billing/domain/event/subscription_trial_ending_event";
import { NotifyOnSubscriptionPaymentFailed } from "../../application/handler/notify_on_subscription_payment_failed";
import { NotifyOnSubscriptionTrialEnding } from "../../application/handler/notify_on_subscription_trial_ending";
import { PersistingNotificationService } from "../../application/service/persisting_notification_service";
import type { NotificationService } from "../../application/service/notification_service";
import { DeliverPendingNotificationsUseCase } from "../../application/use_case/deliver_pending_notifications";
import { GetNotificationPreferencesUseCase } from "../../application/use_case/get_notification_preferences";
import { UpdateNotificationPreferencesUseCase } from "../../application/use_case/update_notification_preferences";
import { ListNotificationsUseCase } from "../../application/use_case/list_notifications";
import { MarkNotificationReadUseCase } from "../../application/use_case/mark_notification_read";
import type { NotificationRepository } from "../../domain/repository/notification_repository";
import type { NotificationPreferenceRepository } from "../../domain/repository/notification_preference_repository";
import { NotificationPostgresRepository } from "../database/postgres_repository/notification_postgres_repository";
import { NotificationPreferencePostgresRepository } from "../database/postgres_repository/notification_preference_postgres_repository";
import { EmailNotificationChannel } from "../channel/email_notification_channel";
import { NotificationContentRenderer } from "../../domain/service/notification_content_renderer";
import { GetNotificationPreferencesController } from "../../presentation/controller/get_notification_preferences.controller";
import { UpdateNotificationPreferencesController } from "../../presentation/controller/update_notification_preferences.controller";
import { ListNotificationsController } from "../../presentation/controller/list_notifications.controller";
import { MarkNotificationReadController } from "../../presentation/controller/mark_notification_read.controller";
import { makeGetNotificationPreferencesTool } from "../../presentation/mcp_tool/get_notification_preferences.mcp_tool";
import { makeUpdateNotificationPreferencesTool } from "../../presentation/mcp_tool/update_notification_preferences.mcp_tool";
import { makeListNotificationsTool } from "../../presentation/mcp_tool/list_notifications.mcp_tool";
import { makeMarkNotificationReadTool } from "../../presentation/mcp_tool/mark_notification_read.mcp_tool";

export class NotificationDi {
  #logger: Logger;
  #eventDispatcher: EventDispatcher;
  #notificationRepository: NotificationRepository;
  #preferenceRepository: NotificationPreferenceRepository;
  #notificationService: NotificationService;
  #contentRenderer: NotificationContentRenderer;

  constructor() {
    const coreDi = new CoreDi();

    this.#logger = coreDi.makeLogger();
    this.#eventDispatcher = inMemoryEventDispatcher;
    this.#notificationRepository = new NotificationPostgresRepository();
    this.#preferenceRepository = new NotificationPreferencePostgresRepository();
    this.#contentRenderer = new NotificationContentRenderer();
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
    this.#eventDispatcher.register(
      SubscriptionTrialEndingEvent.NAME,
      new NotifyOnSubscriptionTrialEnding(
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
      this.#contentRenderer,
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

  makeListNotificationsUseCase(): ListNotificationsUseCase {
    return new ListNotificationsUseCase(
      this.#logger,
      this.#notificationRepository,
      this.#contentRenderer
    );
  }

  makeMarkNotificationReadUseCase(): MarkNotificationReadUseCase {
    return new MarkNotificationReadUseCase(this.#notificationRepository);
  }

  makeListNotificationsController(): ListNotificationsController {
    return new ListNotificationsController(this.makeListNotificationsUseCase());
  }

  makeMarkNotificationReadController(): MarkNotificationReadController {
    return new MarkNotificationReadController(
      this.makeMarkNotificationReadUseCase()
    );
  }

  makeListNotificationsTool() {
    return makeListNotificationsTool(this.makeListNotificationsUseCase());
  }

  makeMarkNotificationReadTool() {
    return makeMarkNotificationReadTool(this.makeMarkNotificationReadUseCase());
  }
}
