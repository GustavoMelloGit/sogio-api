import type { Subscription } from "../entity/subscription";
import type { Plan } from "../entity/plan";
import { Entitlement } from "../value_object/entitlement";

/**
 * Derives the `Entitlement` for a subscription at `now`. Never persisted —
 * see DA-2: there is no scheduler in this project, so "access" can only ever
 * be a value computed on read.
 */
export class SubscriptionAccessPolicy {
  static resolve(
    subscription: Subscription,
    plan: Plan,
    freePlan: Plan,
    now: Date = new Date()
  ): Entitlement {
    switch (subscription.status) {
      case "trialing":
        return this.#resolveTrialing(subscription, plan, now);
      case "active":
        return this.#resolveActive(subscription, plan, now);
      case "past_due":
        return this.#resolvePastDue(subscription, plan, now);
      case "canceled":
        return this.#resolveCanceled(subscription, plan, freePlan, now);
    }
  }

  static #resolveTrialing(
    subscription: Subscription,
    plan: Plan,
    now: Date
  ): Entitlement {
    if (subscription.trial_ends_at && now <= subscription.trial_ends_at) {
      return Entitlement.of({
        has_platform_access: true,
        status: subscription.status,
        max_properties: plan.max_properties,
      });
    }

    return Entitlement.of({
      has_platform_access: false,
      status: subscription.status,
      max_properties: plan.max_properties,
      blocked_reason: "trial_expired",
    });
  }

  static #resolveActive(
    subscription: Subscription,
    plan: Plan,
    now: Date
  ): Entitlement {
    if (
      !subscription.current_period_end ||
      now <= subscription.current_period_end
    ) {
      return Entitlement.of({
        has_platform_access: true,
        status: subscription.status,
        max_properties: plan.max_properties,
      });
    }

    return Entitlement.of({
      has_platform_access: false,
      status: subscription.status,
      max_properties: plan.max_properties,
      blocked_reason: "period_expired",
    });
  }

  static #resolvePastDue(
    subscription: Subscription,
    plan: Plan,
    now: Date
  ): Entitlement {
    if (
      subscription.grace_period_ends_at &&
      now <= subscription.grace_period_ends_at
    ) {
      return Entitlement.of({
        has_platform_access: true,
        status: subscription.status,
        max_properties: plan.max_properties,
      });
    }

    return Entitlement.of({
      has_platform_access: false,
      status: subscription.status,
      max_properties: plan.max_properties,
      blocked_reason: "payment_failed",
    });
  }

  /**
   * Canceled + expired period reverts to Free — see DA-2's closed decision.
   * A null `current_period_end` is never treated as "within period": that
   * would perpetuate paid-plan access forever instead of reverting to Free.
   */
  static #resolveCanceled(
    subscription: Subscription,
    plan: Plan,
    freePlan: Plan,
    now: Date
  ): Entitlement {
    if (
      subscription.current_period_end &&
      now <= subscription.current_period_end
    ) {
      return Entitlement.of({
        has_platform_access: true,
        status: subscription.status,
        max_properties: plan.max_properties,
      });
    }

    return Entitlement.of({
      has_platform_access: true,
      status: subscription.status,
      max_properties: freePlan.max_properties,
    });
  }
}
