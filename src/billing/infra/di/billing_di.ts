import { UserCreatedEvent } from "../../../auth/domain/event/user_created_event";
import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import type { Logger } from "../../../core/application/logger/logger";
import { inMemoryEventDispatcher } from "../../../core/infra/event/in_memory_event_dispatcher";
import { ConsoleLogger } from "../../../core/infra/logger/console_logger";
import { env, frontBaseUrl } from "../../../core/infra/config/environments";
import type { PlanRepository } from "../../domain/repository/plan_repository";
import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";
import type { SubscriptionHistoryRepository } from "../../domain/repository/subscription_history_repository";
import type { ProcessedGatewayEventRepository } from "../../domain/repository/processed_gateway_event_repository";
import { PlanPostgresRepository } from "../database/postgres_repository/plan_postgres_repository";
import { SubscriptionPostgresRepository } from "../database/postgres_repository/subscription_postgres_repository";
import { SubscriptionHistoryPostgresRepository } from "../database/postgres_repository/subscription_history_postgres_repository";
import { ProcessedGatewayEventPostgresRepository } from "../database/postgres_repository/processed_gateway_event_postgres_repository";
import type { EntitlementService } from "../../application/service/entitlement_service";
import { SubscriptionEntitlementService } from "../../application/service/subscription_entitlement_service";
import type { PaymentGateway } from "../../application/gateway/payment_gateway";
import type { GatewayWebhookVerifier } from "../../application/gateway/gateway_webhook_verifier";
import { StripePaymentGateway } from "../gateway/stripe_payment_gateway";
import { StripeWebhookVerifier } from "../gateway/stripe_webhook_verifier";
import { ListPlansUseCase } from "../../application/use_case/list_plans";
import { GrantPlanUseCase } from "../../application/use_case/grant_plan";
import { CancelSubscriptionUseCase } from "../../application/use_case/cancel_subscription";
import { GetSubscriptionStatusUseCase } from "../../application/use_case/get_subscription_status";
import { EnsureFreeSubscriptionUseCase } from "../../application/use_case/ensure_free_subscription";
import { MarkSubscriptionPastDueUseCase } from "../../application/use_case/mark_subscription_past_due";
import { RecordSubscriptionHistoryEntryUseCase } from "../../application/use_case/record_subscription_history_entry";
import { GetSubscriptionHistoryUseCase } from "../../application/use_case/get_subscription_history";
import { CreateCheckoutSessionUseCase } from "../../application/use_case/create_checkout_session";
import { CreateBillingPortalSessionUseCase } from "../../application/use_case/create_billing_portal_session";
import { BindGatewayCustomerUseCase } from "../../application/use_case/bind_gateway_customer";
import { SyncSubscriptionFromGatewayUseCase } from "../../application/use_case/sync_subscription_from_gateway";
import { ProcessGatewayWebhookUseCase } from "../../application/use_case/process_gateway_webhook";
import { SyncPlanCatalogEntryUseCase } from "../../application/use_case/sync_plan_catalog_entry";
import { ReconcilePlanCatalogFromGatewayUseCase } from "../../application/use_case/reconcile_plan_catalog_from_gateway";
import { StartFreeSubscriptionOnUserCreated } from "../../application/handler/start_free_subscription_on_user_created";
import { RecordHistoryOnSubscriptionStarted } from "../../application/handler/record_history_on_subscription_started";
import { RecordHistoryOnSubscriptionPlanChanged } from "../../application/handler/record_history_on_subscription_plan_changed";
import { RecordHistoryOnSubscriptionPaymentFailed } from "../../application/handler/record_history_on_subscription_payment_failed";
import { RecordHistoryOnSubscriptionCanceled } from "../../application/handler/record_history_on_subscription_canceled";
import { RecordHistoryOnSubscriptionRenewed } from "../../application/handler/record_history_on_subscription_renewed";
import { SubscriptionStartedEvent } from "../../domain/event/subscription_started_event";
import { SubscriptionPlanChangedEvent } from "../../domain/event/subscription_plan_changed_event";
import { SubscriptionPaymentFailedEvent } from "../../domain/event/subscription_payment_failed_event";
import { SubscriptionCanceledEvent } from "../../domain/event/subscription_canceled_event";
import { SubscriptionRenewedEvent } from "../../domain/event/subscription_renewed_event";
import { GetSubscriptionStatusController } from "../../presentation/controller/get_subscription_status.controller";
import { makeGetSubscriptionStatusTool } from "../../presentation/mcp_tool/get_subscription_status.mcp_tool";
import { ListPlansController } from "../../presentation/controller/list_plans.controller";
import { GetSubscriptionHistoryController } from "../../presentation/controller/get_subscription_history.controller";
import { CreateCheckoutSessionController } from "../../presentation/controller/create_checkout_session.controller";
import { CreateBillingPortalSessionController } from "../../presentation/controller/create_billing_portal_session.controller";
import { StripeWebhookController } from "../../presentation/controller/stripe_webhook.controller";
import { SyncPlanCatalogController } from "../../presentation/controller/sync_plan_catalog.controller";

export class BillingDi {
  #logger: Logger;
  #eventDispatcher: EventDispatcher;
  #planRepository: PlanRepository;
  #subscriptionRepository: SubscriptionRepository;
  #subscriptionHistoryRepository: SubscriptionHistoryRepository;
  #processedGatewayEventRepository: ProcessedGatewayEventRepository;
  #entitlementService: EntitlementService;
  #paymentGateway: PaymentGateway;
  #gatewayWebhookVerifier: GatewayWebhookVerifier;

  constructor() {
    this.#logger = new ConsoleLogger();
    this.#eventDispatcher = inMemoryEventDispatcher;
    this.#planRepository = new PlanPostgresRepository();
    this.#subscriptionRepository = new SubscriptionPostgresRepository();
    this.#subscriptionHistoryRepository =
      new SubscriptionHistoryPostgresRepository();
    this.#processedGatewayEventRepository =
      new ProcessedGatewayEventPostgresRepository();
    this.#entitlementService = new SubscriptionEntitlementService(
      this.#subscriptionRepository,
      this.#planRepository
    );

    this.#paymentGateway = new StripePaymentGateway(
      env.STRIPE_SECRET_KEY ?? "",
      this.#logger
    );
    this.#gatewayWebhookVerifier = new StripeWebhookVerifier(
      env.STRIPE_WEBHOOK_SECRET ?? "",
      this.#logger
    );
  }

  registerEventHandlers(): void {
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
    this.#eventDispatcher.register(
      SubscriptionRenewedEvent.NAME,
      this.makeRecordHistoryOnSubscriptionRenewedHandler()
    );
  }

  makeEntitlementService(): EntitlementService {
    return this.#entitlementService;
  }

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

  makeRecordHistoryOnSubscriptionRenewedHandler() {
    return new RecordHistoryOnSubscriptionRenewed(
      this.makeRecordSubscriptionHistoryEntryUseCase()
    );
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

  makeCreateCheckoutSessionUseCase() {
    return new CreateCheckoutSessionUseCase(
      this.#subscriptionRepository,
      this.#planRepository,
      this.#paymentGateway,
      frontBaseUrl
    );
  }

  makeCreateBillingPortalSessionUseCase() {
    return new CreateBillingPortalSessionUseCase(
      this.#subscriptionRepository,
      this.#paymentGateway,
      frontBaseUrl
    );
  }

  makeBindGatewayCustomerUseCase() {
    return new BindGatewayCustomerUseCase(
      this.#subscriptionRepository,
      this.#logger
    );
  }

  makeSyncSubscriptionFromGatewayUseCase() {
    return new SyncSubscriptionFromGatewayUseCase(
      this.#subscriptionRepository,
      this.#planRepository,
      this.#eventDispatcher,
      this.makeCancelSubscriptionUseCase(),
      this.#logger
    );
  }

  makeProcessGatewayWebhookUseCase() {
    return new ProcessGatewayWebhookUseCase(
      this.#gatewayWebhookVerifier,
      this.#processedGatewayEventRepository,
      this.#subscriptionRepository,
      this.makeBindGatewayCustomerUseCase(),
      this.makeSyncSubscriptionFromGatewayUseCase(),
      this.makeCancelSubscriptionUseCase(),
      this.makeMarkSubscriptionPastDueUseCase(),
      this.makeSyncPlanCatalogEntryUseCase(),
      this.#logger
    );
  }

  makeSyncPlanCatalogEntryUseCase() {
    return new SyncPlanCatalogEntryUseCase(this.#planRepository, this.#logger);
  }

  makeReconcilePlanCatalogFromGatewayUseCase() {
    return new ReconcilePlanCatalogFromGatewayUseCase(
      this.#paymentGateway,
      this.makeSyncPlanCatalogEntryUseCase(),
      this.#logger
    );
  }

  makeGetSubscriptionStatusController() {
    return new GetSubscriptionStatusController(
      this.makeGetSubscriptionStatusUseCase()
    );
  }

  makeGetSubscriptionStatusTool() {
    return makeGetSubscriptionStatusTool(
      this.makeGetSubscriptionStatusUseCase()
    );
  }

  makeListPlansController() {
    return new ListPlansController(this.makeListPlansUseCase());
  }

  makeGetSubscriptionHistoryController() {
    return new GetSubscriptionHistoryController(
      this.makeGetSubscriptionHistoryUseCase()
    );
  }

  makeCreateCheckoutSessionController() {
    return new CreateCheckoutSessionController(
      this.makeCreateCheckoutSessionUseCase()
    );
  }

  makeCreateBillingPortalSessionController() {
    return new CreateBillingPortalSessionController(
      this.makeCreateBillingPortalSessionUseCase()
    );
  }

  makeStripeWebhookController() {
    return new StripeWebhookController(this.makeProcessGatewayWebhookUseCase());
  }

  makeSyncPlanCatalogController() {
    return new SyncPlanCatalogController(
      this.makeReconcilePlanCatalogFromGatewayUseCase()
    );
  }
}
