import type { UseCase } from "../../../core/application/use_case/use_case";
import type { Logger } from "../../../core/application/logger/logger";
import type { GatewayWebhookVerifier } from "../gateway/gateway_webhook_verifier";
import type {
  GatewayBillingEvent,
  SubscriptionEndedEvent,
  PaymentFailedEvent,
} from "../gateway/gateway_billing_event";
import type { GatewayCatalogEvent } from "../gateway/gateway_catalog_event";
import type { ProcessedGatewayEventRepository } from "../../domain/repository/processed_gateway_event_repository";
import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";
import type { BindGatewayCustomerUseCase } from "./bind_gateway_customer";
import type { SyncSubscriptionFromGatewayUseCase } from "./sync_subscription_from_gateway";
import type { CancelSubscriptionUseCase } from "./cancel_subscription";
import type { MarkSubscriptionPastDueUseCase } from "./mark_subscription_past_due";
import type { SyncPlanCatalogEntryUseCase } from "./sync_plan_catalog_entry";
import {
  resolveGatewaySubscriptionForTermination,
  isStaleGatewayEvent,
} from "../gateway/resolve_gateway_subscription";

type Input = {
  raw_payload: string;
  signature: string | null;
};

type Output = void;

export class ProcessGatewayWebhookUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly verifier: GatewayWebhookVerifier,
    private readonly processedGatewayEventRepository: ProcessedGatewayEventRepository,
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly bindGatewayCustomerUseCase: BindGatewayCustomerUseCase,
    private readonly syncSubscriptionFromGatewayUseCase: SyncSubscriptionFromGatewayUseCase,
    private readonly cancelSubscriptionUseCase: CancelSubscriptionUseCase,
    private readonly markSubscriptionPastDueUseCase: MarkSubscriptionPastDueUseCase,
    private readonly syncPlanCatalogEntryUseCase: SyncPlanCatalogEntryUseCase,
    private readonly logger: Logger
  ) {}

  async execute(input: Input): Promise<Output> {
    const event = await this.verifier.verify({
      raw_payload: input.raw_payload,
      signature: input.signature,
    });

    if (!event) {
      return;
    }

    const claimed = await this.processedGatewayEventRepository.claim(
      event.event_id,
      event.type,
      event.occurred_at
    );
    if (!claimed) {
      return;
    }

    try {
      await this.#dispatch(event);
    } catch (error) {
      this.logger.error(
        "Failed to process gateway webhook event; releasing claim",
        {
          event_id: event.event_id,
          type: event.type,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        }
      );
      await this.processedGatewayEventRepository.release(event.event_id);
      throw error;
    }
  }

  async #dispatch(
    event: GatewayBillingEvent | GatewayCatalogEvent
  ): Promise<void> {
    if (this.#isCatalogEvent(event)) {
      await this.syncPlanCatalogEntryUseCase.execute(event);
      return;
    }

    switch (event.type) {
      case "checkout_completed":
        await this.bindGatewayCustomerUseCase.execute({
          user_id: event.user_id,
          external_customer_reference: event.external_customer_reference,
        });
        return;
      case "subscription_state_changed":
        await this.syncSubscriptionFromGatewayUseCase.execute(event);
        return;
      case "subscription_ended":
        await this.#dispatchSubscriptionEnded(event);
        return;
      case "payment_failed":
        await this.#dispatchPaymentFailed(event);
        return;
    }
  }

  async #dispatchSubscriptionEnded(
    event: SubscriptionEndedEvent
  ): Promise<void> {
    const subscription = await resolveGatewaySubscriptionForTermination(
      this.subscriptionRepository,
      event
    );
    if (!subscription) {
      this.logger.info(
        "subscription_ended for a gateway subscription with no local match by reference — discarding as unknown or stale/irrelevant",
        {
          external_reference: event.external_reference,
          external_customer_reference: event.external_customer_reference,
        }
      );
      return;
    }

    if (isStaleGatewayEvent(subscription, event.occurred_at)) {
      this.logger.info("Discarding a stale gateway event (DA-8)", {
        subscription_id: subscription.id,
        event_occurred_at: event.occurred_at,
      });
      return;
    }

    await this.cancelSubscriptionUseCase.execute({
      user_id: subscription.user_id,
      external_event_at: event.occurred_at,
    });
  }

  async #dispatchPaymentFailed(event: PaymentFailedEvent): Promise<void> {
    const subscription = await resolveGatewaySubscriptionForTermination(
      this.subscriptionRepository,
      event
    );
    if (!subscription) {
      this.logger.info(
        "payment_failed for a gateway subscription with no local match by reference — discarding as unknown or stale/irrelevant",
        {
          external_reference: event.external_reference,
          external_customer_reference: event.external_customer_reference,
        }
      );
      return;
    }

    if (isStaleGatewayEvent(subscription, event.occurred_at)) {
      this.logger.info("Discarding a stale gateway event (DA-8)", {
        subscription_id: subscription.id,
        event_occurred_at: event.occurred_at,
      });
      return;
    }

    if (subscription.status === "canceled") {
      this.logger.info(
        "payment_failed for an already-canceled subscription — nothing to do",
        { subscription_id: subscription.id }
      );
      return;
    }

    await this.markSubscriptionPastDueUseCase.execute({
      user_id: subscription.user_id,
      reason: event.reason,
      occurred_at: event.occurred_at,
    });
  }

  #isCatalogEvent(
    event: GatewayBillingEvent | GatewayCatalogEvent
  ): event is GatewayCatalogEvent {
    return (
      event.type === "catalog_entry_changed" ||
      event.type === "catalog_entry_retired" ||
      event.type === "catalog_product_offering_changed" ||
      event.type === "catalog_product_retired"
    );
  }
}
