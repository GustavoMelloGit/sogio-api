import { describe, expect, it } from "bun:test";
import { SubscriptionAccessPolicy } from "../../src/billing/domain/policy/subscription_access_policy";
import { Plan } from "../../src/billing/domain/entity/plan";
import {
  Subscription,
  type SubscriptionData,
} from "../../src/billing/domain/entity/subscription";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const PAST = new Date("2026-06-01T00:00:00.000Z");
const FUTURE = new Date("2026-07-01T00:00:00.000Z");

const proPlan = Plan.create({
  code: "pro",
  name: "Pro",
  price_amount: 4990,
  billing_interval: "monthly",
  max_properties: 5,
  trial_days: 14,
});

const freePlan = Plan.create({
  code: "free",
  name: "Free",
  price_amount: 0,
  billing_interval: "monthly",
  max_properties: 1,
  trial_days: 0,
});

function makeSubscription(overrides: Partial<SubscriptionData>): Subscription {
  return Subscription.reconstitute({
    id: "b3f6c1a0-0000-4000-8000-000000000001",
    user_id: "b3f6c1a0-0000-4000-8000-000000000002",
    plan_id: proPlan.id,
    status: "active",
    current_period_start: null,
    current_period_end: null,
    trial_ends_at: null,
    canceled_at: null,
    grace_period_ends_at: null,
    external_reference: null,
    external_customer_reference: null,
    created_at: PAST,
    updated_at: PAST,
    ...overrides,
  });
}

describe("SubscriptionAccessPolicy", () => {
  describe("trialing", () => {
    it("grants access while now is before trial_ends_at", () => {
      const subscription = makeSubscription({
        status: "trialing",
        trial_ends_at: FUTURE,
      });

      const entitlement = SubscriptionAccessPolicy.resolve(
        subscription,
        proPlan,
        freePlan,
        NOW
      );

      expect(entitlement.has_platform_access).toBe(true);
      expect(entitlement.status).toBe("trialing");
      expect(entitlement.max_properties).toBe(proPlan.max_properties);
      expect(entitlement.blocked_reason).toBeUndefined();
    });

    it("grants access exactly at the trial_ends_at boundary (inclusive)", () => {
      const subscription = makeSubscription({
        status: "trialing",
        trial_ends_at: NOW,
      });

      const entitlement = SubscriptionAccessPolicy.resolve(
        subscription,
        proPlan,
        freePlan,
        NOW
      );

      expect(entitlement.has_platform_access).toBe(true);
    });

    it("blocks access once now is past trial_ends_at, with blocked_reason trial_expired", () => {
      const subscription = makeSubscription({
        status: "trialing",
        trial_ends_at: PAST,
      });

      const entitlement = SubscriptionAccessPolicy.resolve(
        subscription,
        proPlan,
        freePlan,
        NOW
      );

      expect(entitlement.has_platform_access).toBe(false);
      expect(entitlement.blocked_reason).toBe("trial_expired");
      expect(entitlement.max_properties).toBe(proPlan.max_properties);
    });
  });

  describe("active", () => {
    it("grants access when the period is null (perpetual plan)", () => {
      const subscription = makeSubscription({
        status: "active",
        current_period_start: null,
        current_period_end: null,
      });

      const entitlement = SubscriptionAccessPolicy.resolve(
        subscription,
        freePlan,
        freePlan,
        NOW
      );

      expect(entitlement.has_platform_access).toBe(true);
      expect(entitlement.blocked_reason).toBeUndefined();
    });

    it("grants access while now is before current_period_end", () => {
      const subscription = makeSubscription({
        status: "active",
        current_period_start: PAST,
        current_period_end: FUTURE,
      });

      const entitlement = SubscriptionAccessPolicy.resolve(
        subscription,
        proPlan,
        freePlan,
        NOW
      );

      expect(entitlement.has_platform_access).toBe(true);
      expect(entitlement.max_properties).toBe(proPlan.max_properties);
    });

    it("grants access exactly at the current_period_end boundary (inclusive)", () => {
      const subscription = makeSubscription({
        status: "active",
        current_period_start: PAST,
        current_period_end: NOW,
      });

      const entitlement = SubscriptionAccessPolicy.resolve(
        subscription,
        proPlan,
        freePlan,
        NOW
      );

      expect(entitlement.has_platform_access).toBe(true);
    });

    it("blocks access once now is past current_period_end, with blocked_reason period_expired", () => {
      const subscription = makeSubscription({
        status: "active",
        current_period_start: PAST,
        current_period_end: PAST,
      });

      const entitlement = SubscriptionAccessPolicy.resolve(
        subscription,
        proPlan,
        freePlan,
        NOW
      );

      expect(entitlement.has_platform_access).toBe(false);
      expect(entitlement.blocked_reason).toBe("period_expired");
      expect(entitlement.max_properties).toBe(proPlan.max_properties);
    });
  });

  describe("past_due", () => {
    it("grants access while now is before grace_period_ends_at", () => {
      const subscription = makeSubscription({
        status: "past_due",
        grace_period_ends_at: FUTURE,
      });

      const entitlement = SubscriptionAccessPolicy.resolve(
        subscription,
        proPlan,
        freePlan,
        NOW
      );

      expect(entitlement.has_platform_access).toBe(true);
      expect(entitlement.max_properties).toBe(proPlan.max_properties);
    });

    it("grants access exactly at the grace_period_ends_at boundary (inclusive)", () => {
      const subscription = makeSubscription({
        status: "past_due",
        grace_period_ends_at: NOW,
      });

      const entitlement = SubscriptionAccessPolicy.resolve(
        subscription,
        proPlan,
        freePlan,
        NOW
      );

      expect(entitlement.has_platform_access).toBe(true);
    });

    it("blocks access once now is past grace_period_ends_at, with blocked_reason payment_failed", () => {
      const subscription = makeSubscription({
        status: "past_due",
        grace_period_ends_at: PAST,
      });

      const entitlement = SubscriptionAccessPolicy.resolve(
        subscription,
        proPlan,
        freePlan,
        NOW
      );

      expect(entitlement.has_platform_access).toBe(false);
      expect(entitlement.blocked_reason).toBe("payment_failed");
      expect(entitlement.max_properties).toBe(proPlan.max_properties);
    });
  });

  describe("canceled", () => {
    it("grants access with the subscription's own plan limits while now is before current_period_end", () => {
      const subscription = makeSubscription({
        status: "canceled",
        canceled_at: PAST,
        current_period_start: PAST,
        current_period_end: FUTURE,
      });

      const entitlement = SubscriptionAccessPolicy.resolve(
        subscription,
        proPlan,
        freePlan,
        NOW
      );

      expect(entitlement.has_platform_access).toBe(true);
      expect(entitlement.max_properties).toBe(proPlan.max_properties);
      expect(entitlement.blocked_reason).toBeUndefined();
    });

    it("grants access exactly at the current_period_end boundary (inclusive)", () => {
      const subscription = makeSubscription({
        status: "canceled",
        canceled_at: PAST,
        current_period_start: PAST,
        current_period_end: NOW,
      });

      const entitlement = SubscriptionAccessPolicy.resolve(
        subscription,
        proPlan,
        freePlan,
        NOW
      );

      expect(entitlement.has_platform_access).toBe(true);
      expect(entitlement.max_properties).toBe(proPlan.max_properties);
    });

    it("reverts to the Free plan's limits once the period has expired, without blocking access", () => {
      const subscription = makeSubscription({
        status: "canceled",
        canceled_at: PAST,
        current_period_start: PAST,
        current_period_end: PAST,
      });

      const entitlement = SubscriptionAccessPolicy.resolve(
        subscription,
        proPlan,
        freePlan,
        NOW
      );

      expect(entitlement.has_platform_access).toBe(true);
      expect(entitlement.max_properties).toBe(freePlan.max_properties);
      expect(entitlement.blocked_reason).toBeUndefined();
    });

    it("reverts to the Free plan's limits when the period is null, never granting the paid plan forever (fail-open regression)", () => {
      const subscription = makeSubscription({
        status: "canceled",
        canceled_at: PAST,
        current_period_start: null,
        current_period_end: null,
      });

      const entitlement = SubscriptionAccessPolicy.resolve(
        subscription,
        proPlan,
        freePlan,
        NOW
      );

      expect(entitlement.has_platform_access).toBe(true);
      expect(entitlement.max_properties).toBe(freePlan.max_properties);
      expect(entitlement.blocked_reason).toBeUndefined();
    });

    it("never leaves current_period_end null after canceling a trialing subscription, so access reverts to Free once the trial would have ended", () => {
      const subscription = Subscription.create({
        user_id: "b3f6c1a0-0000-4000-8000-000000000003",
        plan_id: proPlan.id,
        trial_days: proPlan.trial_days,
        is_perpetual: proPlan.is_perpetual,
        billing_interval: proPlan.billing_interval,
        now: PAST,
      });
      expect(subscription.status).toBe("trialing");
      expect(subscription.current_period_end).toBeNull();

      subscription.cancel({ is_perpetual: proPlan.is_perpetual, now: NOW });

      expect(subscription.current_period_end).not.toBeNull();
      expect(subscription.current_period_end).toEqual(
        subscription.trial_ends_at
      );

      const entitlementAfterTrialWouldHaveEnded =
        SubscriptionAccessPolicy.resolve(
          subscription,
          proPlan,
          freePlan,
          FUTURE
        );

      expect(entitlementAfterTrialWouldHaveEnded.has_platform_access).toBe(
        true
      );
      expect(entitlementAfterTrialWouldHaveEnded.max_properties).toBe(
        freePlan.max_properties
      );
    });

    it("reverts to Free immediately when canceling a past_due subscription whose grace period already expired, instead of restoring paid access until the original current_period_end", () => {
      const subscription = makeSubscription({
        status: "past_due",
        current_period_start: PAST,
        current_period_end: FUTURE,
        grace_period_ends_at: PAST,
      });

      subscription.cancel({ is_perpetual: proPlan.is_perpetual, now: NOW });

      expect(subscription.current_period_end).toEqual(PAST);

      const entitlement = SubscriptionAccessPolicy.resolve(
        subscription,
        proPlan,
        freePlan,
        NOW
      );

      expect(entitlement.has_platform_access).toBe(true);
      expect(entitlement.max_properties).toBe(freePlan.max_properties);
    });
  });
});
