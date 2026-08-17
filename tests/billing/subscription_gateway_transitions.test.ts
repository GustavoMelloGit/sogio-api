import { describe, expect, it } from "bun:test";
import { Subscription } from "../../src/billing/domain/entity/subscription";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const USER_ID = "b3f6c1a0-0000-4000-8000-000000000001";
const PLAN_ID = "b3f6c1a0-0000-4000-8000-000000000002";

function paidSubscription(): Subscription {
  return Subscription.create({
    user_id: USER_ID,
    plan_id: PLAN_ID,
    trial_days: 0,
    is_perpetual: false,
    billing_interval: "monthly",
    now: NOW,
  });
}

describe("Subscription.linkCustomer (§2.4 rule 3)", () => {
  it("sets the reference the first time", () => {
    const subscription = paidSubscription();
    subscription.linkCustomer("cus_123");
    expect(subscription.external_customer_reference).toBe("cus_123");
  });

  it("is a no-op when the same reference is set again", () => {
    const subscription = paidSubscription();
    subscription.linkCustomer("cus_123");
    const updatedAt = subscription.updated_at;
    subscription.linkCustomer("cus_123");
    expect(subscription.updated_at).toEqual(updatedAt);
  });

  it("rejects overwriting with a different reference", () => {
    const subscription = paidSubscription();
    subscription.linkCustomer("cus_123");
    expect(() => subscription.linkCustomer("cus_456")).toThrow();
  });
});

describe("Subscription.activate — gateway period (§2.3)", () => {
  it("uses the supplied period_end literally instead of BillingCyclePolicy", () => {
    const subscription = paidSubscription();
    const gatewayPeriodEnd = new Date("2027-01-01T00:00:00.000Z");

    subscription.activate({
      is_perpetual: false,
      period_end: gatewayPeriodEnd,
      external_reference: "sub_gateway_1",
      now: NOW,
    });

    expect(subscription.current_period_end).toEqual(gatewayPeriodEnd);
    expect(subscription.external_reference).toBe("sub_gateway_1");
  });
});

describe("Subscription.startTrialUntil (§2.5)", () => {
  it("starts a trial ending at the gateway-supplied date", () => {
    const subscription = Subscription.create({
      user_id: USER_ID,
      plan_id: PLAN_ID,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      now: NOW,
    });
    const trialEnd = new Date("2026-06-29T12:00:00.000Z");

    subscription.startTrialUntil(trialEnd, { external_reference: "sub_1" });

    expect(subscription.status).toBe("trialing");
    expect(subscription.trial_ends_at).toEqual(trialEnd);
    expect(subscription.external_reference).toBe("sub_1");
  });

  it("rejects starting a second trial", () => {
    const subscription = Subscription.create({
      user_id: USER_ID,
      plan_id: PLAN_ID,
      trial_days: 14,
      is_perpetual: false,
      billing_interval: "monthly",
      now: NOW,
    });

    expect(() =>
      subscription.startTrialUntil(new Date("2026-07-01T00:00:00.000Z"))
    ).toThrow();
  });
});

describe("Subscription.markPastDue — tolerant + anchored (§2.4 rule 1)", () => {
  it("accepts active, trialing and past_due; rejects only canceled", () => {
    const active = paidSubscription();
    expect(() =>
      active.markPastDue(new Date("2026-06-22T12:00:00.000Z"))
    ).not.toThrow();

    const trialing = Subscription.create({
      user_id: USER_ID,
      plan_id: PLAN_ID,
      trial_days: 14,
      is_perpetual: false,
      billing_interval: "monthly",
      now: NOW,
    });
    expect(() =>
      trialing.markPastDue(new Date("2026-06-22T12:00:00.000Z"))
    ).not.toThrow();

    const canceled = paidSubscription();
    canceled.cancel({ is_perpetual: false, now: NOW });
    expect(() =>
      canceled.markPastDue(new Date("2026-06-22T12:00:00.000Z"))
    ).toThrow();
  });

  it("keeps the original grace_period_ends_at on reentry", () => {
    const subscription = paidSubscription();
    const firstGrace = new Date("2026-06-22T12:00:00.000Z");
    const secondGrace = new Date("2026-06-29T12:00:00.000Z");

    subscription.markPastDue(firstGrace);
    subscription.markPastDue(secondGrace);

    expect(subscription.grace_period_ends_at).toEqual(firstGrace);
  });
});

describe("Subscription.cancel — idempotent (§2.4 rule 2)", () => {
  it("is a silent no-op when already canceled", () => {
    const subscription = paidSubscription();
    subscription.cancel({ is_perpetual: false, now: NOW });
    const canceledAt = subscription.canceled_at;

    expect(() =>
      subscription.cancel({ is_perpetual: false, now: NOW })
    ).not.toThrow();
    expect(subscription.status).toBe("canceled");
    expect(subscription.canceled_at).toEqual(canceledAt);
  });

  it("still rejects canceling a perpetual plan", () => {
    const subscription = Subscription.create({
      user_id: USER_ID,
      plan_id: PLAN_ID,
      trial_days: 0,
      is_perpetual: true,
      billing_interval: "monthly",
      now: NOW,
    });

    expect(() =>
      subscription.cancel({ is_perpetual: true, now: NOW })
    ).toThrow();
  });
});

describe("Subscription.external_event_at (DA-8)", () => {
  it("is recorded by activate, markPastDue and cancel when supplied", () => {
    const subscription = paidSubscription();
    const eventAt = new Date("2026-06-20T00:00:00.000Z");

    subscription.activate({
      is_perpetual: false,
      period_end: new Date("2027-01-01T00:00:00.000Z"),
      external_event_at: eventAt,
      now: NOW,
    });

    expect(subscription.external_event_at).toEqual(eventAt);
  });
});
