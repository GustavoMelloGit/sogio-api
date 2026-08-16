import type { UseCase } from "../../../core/application/use_case/use_case";
import type { Logger } from "../../../core/application/logger/logger";
import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import type { PlanRepository } from "../../domain/repository/plan_repository";
import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";
import type {
  Subscription,
  SubscriptionStatus,
} from "../../domain/entity/subscription";
import type { Plan } from "../../domain/entity/plan";
import type { SubscriptionStateChangedEvent } from "../gateway/gateway_billing_event";
import type { CancelSubscriptionUseCase } from "./cancel_subscription";
import { SubscriptionPlanChangedEvent } from "../../domain/event/subscription_plan_changed_event";
import { SubscriptionRenewedEvent } from "../../domain/event/subscription_renewed_event";
import {
  resolveGatewaySubscription,
  isStaleGatewayEvent,
} from "../gateway/resolve_gateway_subscription";

type Output = void;

type StateSnapshot = {
  plan_id: string;
  status: SubscriptionStatus;
  current_period_end: number | null;
};

/**
 * Implements the DA-9 status mapping — the workhorse of the webhook:
 * activation, renewal, plan switch from the portal, recovery. Never touches
 * `ConflictError`-throwing code paths itself, since `canceled` /
 * `incomplete_expired` delegate wholesale to `CancelSubscriptionUseCase`,
 * which is already idempotent (§2.4).
 */
export class SyncSubscriptionFromGatewayUseCase
  implements UseCase<SubscriptionStateChangedEvent, Output>
{
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly planRepository: PlanRepository,
    private readonly eventDispatcher: EventDispatcher,
    private readonly cancelSubscriptionUseCase: CancelSubscriptionUseCase,
    private readonly logger: Logger
  ) {}

  async execute(event: SubscriptionStateChangedEvent): Promise<Output> {
    const subscription = await resolveGatewaySubscription(
      this.subscriptionRepository,
      event
    );
    if (!subscription) {
      this.logger.error(
        "subscription_state_changed for an unknown gateway subscription/customer",
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

    switch (event.status) {
      case "canceled":
      case "incomplete_expired":
        await this.cancelSubscriptionUseCase.execute({
          user_id: subscription.user_id,
        });
        return;
      case "past_due":
      case "unpaid":
        // Sourced only from invoice.payment_failed (DA-9) — consuming both
        // would double-write the history for a single real-world failure.
        return;
      case "incomplete":
      case "paused":
        this.logger.debug("Ignoring subscription_state_changed", {
          subscription_id: subscription.id,
          status: event.status,
        });
        return;
      case "active":
        await this.#syncToActive(subscription, event, event.current_period_end);
        return;
      case "trialing":
        await this.#syncTrialing(subscription, event);
        return;
    }
  }

  async #syncTrialing(
    subscription: Subscription,
    event: SubscriptionStateChangedEvent
  ): Promise<void> {
    if (subscription.trial_ends_at !== null) {
      // §2.5: the invariant against re-trialing is honored — the period the
      // gateway reports is still trusted, just not labeled a trial.
      this.logger.error(
        "Gateway reported trialing for a subscription that already used its trial — treating as active",
        { subscription_id: subscription.id }
      );
      await this.#syncToActive(subscription, event, event.trial_end);
      return;
    }

    const plan = await this.#resolvePlan(event);
    if (!plan) return;

    const previous = this.#snapshot(subscription);

    subscription.changePlan({
      plan_id: plan.id,
      trial_days: plan.trial_days,
      trial_ends_at: event.trial_end ?? event.occurred_at,
      is_perpetual: plan.is_perpetual,
      billing_interval: plan.billing_interval,
      external_reference: event.external_reference,
      external_event_at: event.occurred_at,
    });
    await this.subscriptionRepository.save(subscription);

    if (!this.#changed(previous, subscription)) return;

    await this.eventDispatcher.dispatch(
      new SubscriptionPlanChangedEvent({
        subscription_id: subscription.id,
        user_id: subscription.user_id,
        plan_id: subscription.plan_id,
        status: subscription.status,
        trial_ends_at: subscription.trial_ends_at,
        current_period_end: subscription.current_period_end,
        opens_paid_cycle: subscription.has_paid_cycle,
      })
    );
  }

  async #syncToActive(
    subscription: Subscription,
    event: SubscriptionStateChangedEvent,
    periodEnd: Date | null
  ): Promise<void> {
    if (!periodEnd) {
      this.logger.error(
        "subscription_state_changed(active) without a resolvable period_end",
        { subscription_id: subscription.id }
      );
      return;
    }

    const plan = await this.#resolvePlan(event);
    const isPlanChange = plan !== null && plan.id !== subscription.plan_id;
    const previous = this.#snapshot(subscription);

    if (isPlanChange && plan) {
      subscription.changePlan({
        plan_id: plan.id,
        trial_days: plan.trial_days,
        is_perpetual: plan.is_perpetual,
        billing_interval: plan.billing_interval,
        period_end: periodEnd,
        external_reference: event.external_reference,
        external_event_at: event.occurred_at,
      });
    } else {
      subscription.activate({
        is_perpetual: false,
        period_end: periodEnd,
        external_reference: event.external_reference,
        external_event_at: event.occurred_at,
      });
    }

    await this.subscriptionRepository.save(subscription);

    if (!this.#changed(previous, subscription)) return;

    if (isPlanChange) {
      await this.eventDispatcher.dispatch(
        new SubscriptionPlanChangedEvent({
          subscription_id: subscription.id,
          user_id: subscription.user_id,
          plan_id: subscription.plan_id,
          status: subscription.status,
          trial_ends_at: subscription.trial_ends_at,
          current_period_end: subscription.current_period_end,
          opens_paid_cycle: subscription.has_paid_cycle,
        })
      );
      return;
    }

    await this.eventDispatcher.dispatch(
      new SubscriptionRenewedEvent({
        subscription_id: subscription.id,
        user_id: subscription.user_id,
        plan_id: subscription.plan_id,
        current_period_end: subscription.current_period_end,
      })
    );
  }

  async #resolvePlan(
    event: SubscriptionStateChangedEvent
  ): Promise<Plan | null> {
    if (!event.external_price_reference) return null;

    const plan = await this.planRepository.planOfExternalPriceReference(
      event.external_price_reference
    );
    if (!plan) {
      // A price created in the dashboard and never mapped locally must not
      // be able to drop a paying customer's entitlement (DA-9).
      this.logger.error(
        "No local plan matches the gateway's price reference — syncing period only",
        { external_price_reference: event.external_price_reference }
      );
    }
    return plan;
  }

  #snapshot(subscription: Subscription): StateSnapshot {
    return {
      plan_id: subscription.plan_id,
      status: subscription.status,
      current_period_end: subscription.current_period_end?.getTime() ?? null,
    };
  }

  /** §2.6's anti-noise rule: only plan_id, status or current_period_end changing counts as a real change. */
  #changed(previous: StateSnapshot, subscription: Subscription): boolean {
    return (
      previous.plan_id !== subscription.plan_id ||
      previous.status !== subscription.status ||
      previous.current_period_end !==
        (subscription.current_period_end?.getTime() ?? null)
    );
  }
}
