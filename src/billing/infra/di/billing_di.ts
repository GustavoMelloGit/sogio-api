import { UserCreatedEvent } from "../../../auth/domain/event/user_created_event";
import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import type { Logger } from "../../../core/application/logger/logger";
import { inMemoryEventDispatcher } from "../../../core/infra/event/in_memory_event_dispatcher";
import { ConsoleLogger } from "../../../core/infra/logger/console_logger";
import type { PlanRepository } from "../../domain/repository/plan_repository";
import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";
import type { SubscriptionHistoryRepository } from "../../domain/repository/subscription_history_repository";
import { PlanPostgresRepository } from "../database/postgres_repository/plan_postgres_repository";
import { SubscriptionPostgresRepository } from "../database/postgres_repository/subscription_postgres_repository";
import { SubscriptionHistoryPostgresRepository } from "../database/postgres_repository/subscription_history_postgres_repository";
import type { EntitlementService } from "../../application/service/entitlement_service";
import { SubscriptionEntitlementService } from "../../application/service/subscription_entitlement_service";
import { CreatePlanUseCase } from "../../application/use_case/create_plan";
import { ListPlansUseCase } from "../../application/use_case/list_plans";
import { GrantPlanUseCase } from "../../application/use_case/grant_plan";
import { CancelSubscriptionUseCase } from "../../application/use_case/cancel_subscription";
import { GetSubscriptionStatusUseCase } from "../../application/use_case/get_subscription_status";
import { EnsureFreeSubscriptionUseCase } from "../../application/use_case/ensure_free_subscription";
import { MarkSubscriptionPastDueUseCase } from "../../application/use_case/mark_subscription_past_due";
import { RecordSubscriptionHistoryEntryUseCase } from "../../application/use_case/record_subscription_history_entry";
import { GetSubscriptionHistoryUseCase } from "../../application/use_case/get_subscription_history";
import { StartFreeSubscriptionOnUserCreated } from "../../application/handler/start_free_subscription_on_user_created";
import { RecordHistoryOnSubscriptionStarted } from "../../application/handler/record_history_on_subscription_started";
import { RecordHistoryOnSubscriptionPlanChanged } from "../../application/handler/record_history_on_subscription_plan_changed";
import { RecordHistoryOnSubscriptionPaymentFailed } from "../../application/handler/record_history_on_subscription_payment_failed";
import { RecordHistoryOnSubscriptionCanceled } from "../../application/handler/record_history_on_subscription_canceled";
import { SubscriptionStartedEvent } from "../../domain/event/subscription_started_event";
import { SubscriptionPlanChangedEvent } from "../../domain/event/subscription_plan_changed_event";
import { SubscriptionPaymentFailedEvent } from "../../domain/event/subscription_payment_failed_event";
import { SubscriptionCanceledEvent } from "../../domain/event/subscription_canceled_event";
import { GetSubscriptionStatusController } from "../../presentation/controller/get_subscription_status.controller";
import { GetSubscriptionHistoryController } from "../../presentation/controller/get_subscription_history.controller";

/**
 * Registers `StartFreeSubscriptionOnUserCreated` and the four subscription
 * history handlers on the shared in-memory event dispatcher from the
 * constructor — not idempotent, so this class must be instantiated exactly
 * once (mirrors `FinanceDi`, DA-7). A second instance would double every
 * history entry.
 */
export class BillingDi {
  #logger: Logger;
  #eventDispatcher: EventDispatcher;
  #planRepository: PlanRepository;
  #subscriptionRepository: SubscriptionRepository;
  #subscriptionHistoryRepository: SubscriptionHistoryRepository;
  #entitlementService: EntitlementService;

  constructor() {
    this.#logger = new ConsoleLogger();
    this.#eventDispatcher = inMemoryEventDispatcher;
    this.#planRepository = new PlanPostgresRepository();
    this.#subscriptionRepository = new SubscriptionPostgresRepository();
    this.#subscriptionHistoryRepository =
      new SubscriptionHistoryPostgresRepository();
    this.#entitlementService = new SubscriptionEntitlementService(
      this.#subscriptionRepository,
      this.#planRepository
    );

    this.#eventDispatcher.register(
      UserCreatedEvent.NAME,
      this.makeStartFreeSubscriptionOnUserCreatedHandler()
    );
    this.#eventDispatcher.register(
      SubscriptionStartedEvent.NAME,
      this.makeRecordHistoryOnSubscriptionStartedHandler()
    );
    this.#eventDispatcher.register(
      SubscriptionPlanChangedEvent.NAME,
      this.makeRecordHistoryOnSubscriptionPlanChangedHandler()
    );
    this.#eventDispatcher.register(
      SubscriptionPaymentFailedEvent.NAME,
      this.makeRecordHistoryOnSubscriptionPaymentFailedHandler()
    );
    this.#eventDispatcher.register(
      SubscriptionCanceledEvent.NAME,
      this.makeRecordHistoryOnSubscriptionCanceledHandler()
    );
  }

  makeEntitlementService(): EntitlementService {
    return this.#entitlementService;
  }

  // Handlers
  makeStartFreeSubscriptionOnUserCreatedHandler() {
    return new StartFreeSubscriptionOnUserCreated(
      this.#logger,
      this.makeEnsureFreeSubscriptionUseCase()
    );
  }

  makeRecordHistoryOnSubscriptionStartedHandler() {
    return new RecordHistoryOnSubscriptionStarted(
      this.makeRecordSubscriptionHistoryEntryUseCase()
    );
  }

  makeRecordHistoryOnSubscriptionPlanChangedHandler() {
    return new RecordHistoryOnSubscriptionPlanChanged(
      this.makeRecordSubscriptionHistoryEntryUseCase()
    );
  }

  makeRecordHistoryOnSubscriptionPaymentFailedHandler() {
    return new RecordHistoryOnSubscriptionPaymentFailed(
      this.makeRecordSubscriptionHistoryEntryUseCase()
    );
  }

  makeRecordHistoryOnSubscriptionCanceledHandler() {
    return new RecordHistoryOnSubscriptionCanceled(
      this.makeRecordSubscriptionHistoryEntryUseCase()
    );
  }

  // Use Cases
  makeCreatePlanUseCase() {
    return new CreatePlanUseCase(this.#planRepository);
  }

  makeListPlansUseCase() {
    return new ListPlansUseCase(this.#planRepository);
  }

  makeGrantPlanUseCase() {
    return new GrantPlanUseCase(
      this.#subscriptionRepository,
      this.#planRepository,
      this.#eventDispatcher
    );
  }

  makeCancelSubscriptionUseCase() {
    return new CancelSubscriptionUseCase(
      this.#subscriptionRepository,
      this.#planRepository,
      this.#eventDispatcher
    );
  }

  makeGetSubscriptionStatusUseCase() {
    return new GetSubscriptionStatusUseCase(this.#entitlementService);
  }

  makeEnsureFreeSubscriptionUseCase() {
    return new EnsureFreeSubscriptionUseCase(
      this.#subscriptionRepository,
      this.#planRepository,
      this.#eventDispatcher
    );
  }

  makeMarkSubscriptionPastDueUseCase() {
    return new MarkSubscriptionPastDueUseCase(
      this.#subscriptionRepository,
      this.#eventDispatcher
    );
  }

  makeRecordSubscriptionHistoryEntryUseCase() {
    return new RecordSubscriptionHistoryEntryUseCase(
      this.#logger,
      this.#subscriptionHistoryRepository
    );
  }

  makeGetSubscriptionHistoryUseCase() {
    return new GetSubscriptionHistoryUseCase(
      this.#subscriptionHistoryRepository
    );
  }

  // Controllers
  makeGetSubscriptionStatusController() {
    return new GetSubscriptionStatusController(
      this.makeGetSubscriptionStatusUseCase()
    );
  }

  makeGetSubscriptionHistoryController() {
    return new GetSubscriptionHistoryController(
      this.makeGetSubscriptionHistoryUseCase()
    );
  }
}
