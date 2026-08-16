import { UserCreatedEvent } from "../../../auth/domain/event/user_created_event";
import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import type { Logger } from "../../../core/application/logger/logger";
import { inMemoryEventDispatcher } from "../../../core/infra/event/in_memory_event_dispatcher";
import { ConsoleLogger } from "../../../core/infra/logger/console_logger";
import type { PlanRepository } from "../../domain/repository/plan_repository";
import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";
import { PlanPostgresRepository } from "../database/postgres_repository/plan_postgres_repository";
import { SubscriptionPostgresRepository } from "../database/postgres_repository/subscription_postgres_repository";
import type { EntitlementService } from "../../application/service/entitlement_service";
import { SubscriptionEntitlementService } from "../../application/service/subscription_entitlement_service";
import { CreatePlanUseCase } from "../../application/use_case/create_plan";
import { ListPlansUseCase } from "../../application/use_case/list_plans";
import { SubscribeToPlanUseCase } from "../../application/use_case/subscribe_to_plan";
import { CancelSubscriptionUseCase } from "../../application/use_case/cancel_subscription";
import { GetSubscriptionStatusUseCase } from "../../application/use_case/get_subscription_status";
import { EnsureFreeSubscriptionUseCase } from "../../application/use_case/ensure_free_subscription";
import { StartFreeSubscriptionOnUserCreated } from "../../application/handler/start_free_subscription_on_user_created";

/**
 * Registers `StartFreeSubscriptionOnUserCreated` on the shared in-memory
 * event dispatcher from the constructor — not idempotent, so this class
 * must be instantiated exactly once (mirrors `FinanceDi`).
 */
export class BillingDi {
  #logger: Logger;
  #eventDispatcher: EventDispatcher;
  #planRepository: PlanRepository;
  #subscriptionRepository: SubscriptionRepository;
  #entitlementService: EntitlementService;

  constructor() {
    this.#logger = new ConsoleLogger();
    this.#eventDispatcher = inMemoryEventDispatcher;
    this.#planRepository = new PlanPostgresRepository();
    this.#subscriptionRepository = new SubscriptionPostgresRepository();
    this.#entitlementService = new SubscriptionEntitlementService(
      this.#subscriptionRepository,
      this.#planRepository
    );

    this.#eventDispatcher.register(
      UserCreatedEvent.NAME,
      this.makeStartFreeSubscriptionOnUserCreatedHandler()
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

  // Use Cases
  makeCreatePlanUseCase() {
    return new CreatePlanUseCase(this.#planRepository);
  }

  makeListPlansUseCase() {
    return new ListPlansUseCase(this.#planRepository);
  }

  makeSubscribeToPlanUseCase() {
    return new SubscribeToPlanUseCase(
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
      this.#planRepository
    );
  }
}
