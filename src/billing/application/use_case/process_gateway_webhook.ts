import type { UseCase } from "../../../core/application/use_case/use_case";
import type { Logger } from "../../../core/application/logger/logger";
import type { GatewayWebhookVerifier } from "../gateway/gateway_webhook_verifier";
import type {
  GatewayBillingEvent,
  SubscriptionEndedEvent,
  PaymentFailedEvent,
} from "../gateway/gateway_billing_event";
import type { ProcessedGatewayEventRepository } from "../../domain/repository/processed_gateway_event_repository";
import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";
import type { BindGatewayCustomerUseCase } from "./bind_gateway_customer";
import type { SyncSubscriptionFromGatewayUseCase } from "./sync_subscription_from_gateway";
import type { CancelSubscriptionUseCase } from "./cancel_subscription";
import type { MarkSubscriptionPastDueUseCase } from "./mark_subscription_past_due";
import {
  resolveGatewaySubscriptionForTermination,
  isStaleGatewayEvent,
} from "../gateway/resolve_gateway_subscription";

type Input = {
  raw_payload: string;
  signature: string | null;
};

type Output = void;

/**
 * The webhook's whole trust boundary and idempotency machine in one place
 * (DA-2, DA-7). Verification is the very first instruction — there is no
 * path from here into a domain transition with an unverified event.
 *
 * The HTTP adapter's existing error-code map does the rest of DA-3 for
 * free: `UnauthorizedError` from the verifier becomes 401, an unmapped
 * exception becomes 500 (triggering the gateway's retry), and returning
 * normally becomes 200 — this use case never computes a status code itself.
 */
export class ProcessGatewayWebhookUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly verifier: GatewayWebhookVerifier,
    private readonly processedGatewayEventRepository: ProcessedGatewayEventRepository,
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly bindGatewayCustomerUseCase: BindGatewayCustomerUseCase,
    private readonly syncSubscriptionFromGatewayUseCase: SyncSubscriptionFromGatewayUseCase,
    private readonly cancelSubscriptionUseCase: CancelSubscriptionUseCase,
    private readonly markSubscriptionPastDueUseCase: MarkSubscriptionPastDueUseCase,
    private readonly logger: Logger
  ) {}

  async execute(input: Input): Promise<Output> {
    const event = await this.verifier.verify({
      raw_payload: input.raw_payload,
      signature: input.signature,
    });

    if (!event) {
      // Verified, but a type this system doesn't act on (DA-3): 200, no write.
      return;
    }

    const claimed = await this.processedGatewayEventRepository.claim(
      event.event_id,
      event.type,
      event.occurred_at
    );
    if (!claimed) {
      // Reentry of an already-processed event (DA-7): 200, no-op.
      return;
    }

    try {
      await this.#dispatch(event);
    } catch (error) {
      // R-6: release so the gateway's own retry can claim again. A
      // ConflictError must never reach here (DA-3) — if it does, it's a bug
      // in the plan being followed incorrectly, not a legitimate retry
      // signal, and it will surface as a 409 the gateway loops forever on.
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

  async #dispatch(event: GatewayBillingEvent): Promise<void> {
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
    // resolveGatewaySubscriptionForTermination (security review B-3/B-5)
    // never falls back to a customer-reference match, so a null here means
    // either a truly unknown gateway subscription or one this local row
    // isn't linked to by reference — either way, nothing to cancel.
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
    // Same fallback hazard as #dispatchSubscriptionEnded (security review
    // B-4/B-5) — resolveGatewaySubscriptionForTermination never falls back
    // to a customer-reference match, so marking a wrong/unrelated local
    // subscription past_due is structurally impossible here.
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

    // Dunning's final payment_failed can be delivered after the
    // subscription was already canceled (delivery order isn't guaranteed).
    // markPastDue rejects `canceled` with a ConflictError, so short-circuit
    // here rather than let that escape as a 409 the gateway retries forever.
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
}
