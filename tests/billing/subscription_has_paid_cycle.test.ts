import { describe, expect, it } from "bun:test";
import { Subscription } from "../../src/billing/domain/entity/subscription";

const NOW = new Date("2026-06-15T12:00:00.000Z");

const USER_ID = "b3f6c1a0-0000-4000-8000-000000000001";
const FREE_PLAN_ID = "b3f6c1a0-0000-4000-8000-000000000002";
const PRO_PLAN_ID = "b3f6c1a0-0000-4000-8000-000000000003";

describe("Subscription.has_paid_cycle", () => {
  it("is false for create() on the Free (perpetual) plan", () => {
    const subscription = Subscription.create({
      user_id: USER_ID,
      plan_id: FREE_PLAN_ID,
      trial_days: 0,
      is_perpetual: true,
      billing_interval: "monthly",
      now: NOW,
    });

    expect(subscription.status).toBe("active");
    expect(subscription.current_period_end).toBeNull();
    expect(subscription.has_paid_cycle).toBe(false);
  });

  it("is true for create() on a paid plan without a trial", () => {
    const subscription = Subscription.create({
      user_id: USER_ID,
      plan_id: PRO_PLAN_ID,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      now: NOW,
    });

    expect(subscription.status).toBe("active");
    expect(subscription.current_period_end).not.toBeNull();
    expect(subscription.has_paid_cycle).toBe(true);
  });

  it("is false after startTrial()", () => {
    const subscription = Subscription.create({
      user_id: USER_ID,
      plan_id: PRO_PLAN_ID,
      trial_days: 14,
      is_perpetual: false,
      billing_interval: "monthly",
      now: NOW,
    });

    expect(subscription.status).toBe("trialing");
    expect(subscription.current_period_end).toBeNull();
    expect(subscription.has_paid_cycle).toBe(false);
  });

  it("is false after activate({ is_perpetual: true })", () => {
    const subscription = Subscription.create({
      user_id: USER_ID,
      plan_id: FREE_PLAN_ID,
      trial_days: 0,
      is_perpetual: true,
      billing_interval: "monthly",
      now: NOW,
    });

    subscription.activate({ is_perpetual: true, now: NOW });

    expect(subscription.status).toBe("active");
    expect(subscription.current_period_end).toBeNull();
    expect(subscription.has_paid_cycle).toBe(false);
  });

  it("is true after activate({ is_perpetual: false })", () => {
    const subscription = Subscription.create({
      user_id: USER_ID,
      plan_id: FREE_PLAN_ID,
      trial_days: 0,
      is_perpetual: true,
      billing_interval: "monthly",
      now: NOW,
    });

    subscription.activate({
      is_perpetual: false,
      billing_interval: "monthly",
      now: NOW,
    });

    expect(subscription.status).toBe("active");
    expect(subscription.current_period_end).not.toBeNull();
    expect(subscription.has_paid_cycle).toBe(true);
  });

  it("is false after markPastDue()", () => {
    const subscription = Subscription.create({
      user_id: USER_ID,
      plan_id: PRO_PLAN_ID,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      now: NOW,
    });

    subscription.markPastDue(new Date("2026-06-22T12:00:00.000Z"));

    expect(subscription.status).toBe("past_due");
    expect(subscription.current_period_end).not.toBeNull();
    expect(subscription.has_paid_cycle).toBe(false);
  });

  it("is false after cancel()", () => {
    const subscription = Subscription.create({
      user_id: USER_ID,
      plan_id: PRO_PLAN_ID,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      now: NOW,
    });

    subscription.cancel({ is_perpetual: false, now: NOW });

    expect(subscription.status).toBe("canceled");
    expect(subscription.current_period_end).not.toBeNull();
    expect(subscription.has_paid_cycle).toBe(false);
  });
});
