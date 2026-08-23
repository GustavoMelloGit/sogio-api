import { describe, expect, it } from "bun:test";
import { SubscriptionAccessPolicy } from "../../src/billing/domain/policy/subscription_access_policy";
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";
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
  capabilities: { max_properties: 5 },
  trial_days: 14,
});

const freePlan = Plan.create({
  code: "free",
  name: "Free",
  price_amount: 0,
  billing_interval: "monthly",
  capabilities: { max_properties: 1 },
  trial_days: 0,
});

const proMaxProperties = CapabilitySet.of(proPlan.capabilities).limitOf(
  "max_properties"
);
const freeMaxProperties = CapabilitySet.of(freePlan.capabilities).limitOf(
  "max_properties"
);

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
      expect(entitlement.capabilities.limitOf("max_properties")).toBe(
        proMaxProperties
      );
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
      expect(entitlement.capabilities.limitOf("max_properties")).toBe(
        proMaxProperties
      );
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
      expect(entitlement.capabilities.limitOf("max_properties")).toBe(
        proMaxProperties
      );
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
      expect(entitlement.capabilities.limitOf("max_properties")).toBe(
        proMaxProperties
      );
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
      expect(entitlement.capabilities.limitOf("max_properties")).toBe(
        proMaxProperties
      );
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
      expect(entitlement.capabilities.limitOf("max_properties")).toBe(
        proMaxProperties
      );
    });
  });

  describe("effective plan", () => {
    it("reports the subscription's own plan while it is entitled", () => {
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

      expect(entitlement.plan).toEqual({
        id: proPlan.id,
        code: "pro",
        name: "Pro",
      });
    });

    it("still reports the plan when access is blocked, so a blocked account can see what it was paying for", () => {
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
      expect(entitlement.plan?.code).toBe("pro");
      expect(entitlement.capabilities.limitOf("max_properties")).toBe(
        proMaxProperties
      );
    });

    it("reports the Free plan once a canceled subscription's period expired, agreeing with max_properties instead of the retired paid plan", () => {
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

      expect(entitlement.plan).toEqual({
        id: freePlan.id,
        code: "free",
        name: "Free",
      });
      expect(entitlement.capabilities.limitOf("max_properties")).toBe(
        freeMaxProperties
      );
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
      expect(entitlement.capabilities.limitOf("max_properties")).toBe(
        proMaxProperties
      );
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
      expect(entitlement.capabilities.limitOf("max_properties")).toBe(
        proMaxProperties
      );
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
      expect(entitlement.capabilities.limitOf("max_properties")).toBe(
        freeMaxProperties
      );
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
      expect(entitlement.capabilities.limitOf("max_properties")).toBe(
        freeMaxProperties
      );
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
      expect(
        entitlementAfterTrialWouldHaveEnded.capabilities.limitOf(
          "max_properties"
        )
      ).toBe(freeMaxProperties);
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
      expect(entitlement.capabilities.limitOf("max_properties")).toBe(
        freeMaxProperties
      );
    });
  });

  describe("canceled — full capability set, not just max_properties (D-8)", () => {
    const proPlanWithReports = Plan.create({
      code: "pro",
      name: "Pro",
      price_amount: 4990,
      billing_interval: "monthly",
      capabilities: {
        max_properties: 5,
        export_reports: true,
        bulk_import: false,
      },
      trial_days: 14,
    });

    const freePlanWithoutReports = Plan.create({
      code: "free",
      name: "Free",
      price_amount: 0,
      billing_interval: "monthly",
      capabilities: {
        max_properties: 1,
        export_reports: false,
        bulk_import: false,
      },
      trial_days: 0,
    });

    it("keeps the Pro plan's export_reports access while the canceled period hasn't ended yet", () => {
      const subscription = makeSubscription({
        plan_id: proPlanWithReports.id,
        status: "canceled",
        canceled_at: PAST,
        current_period_start: PAST,
        current_period_end: FUTURE,
      });

      const entitlement = SubscriptionAccessPolicy.resolve(
        subscription,
        proPlanWithReports,
        freePlanWithoutReports,
        NOW
      );

      expect(entitlement.capabilities.allows("export_reports")).toBe(true);
    });

    it("drops export_reports access once the canceled period has ended, falling back to the Free plan's capability set", () => {
      const subscription = makeSubscription({
        plan_id: proPlanWithReports.id,
        status: "canceled",
        canceled_at: PAST,
        current_period_start: PAST,
        current_period_end: PAST,
      });

      const entitlement = SubscriptionAccessPolicy.resolve(
        subscription,
        proPlanWithReports,
        freePlanWithoutReports,
        NOW
      );

      expect(entitlement.capabilities.allows("export_reports")).toBe(false);
    });
  });
});
