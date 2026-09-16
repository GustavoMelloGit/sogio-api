import { describe, expect, it } from "bun:test";
import { Subscription } from "../../src/billing/domain/entity/subscription";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const USER_ID = "b3f6c1a0-0000-4000-8000-000000000011";
const PLAN_ID = "b3f6c1a0-0000-4000-8000-000000000012";

function freeSubscription(): Subscription {
  return Subscription.create({
    user_id: USER_ID,
    plan_id: PLAN_ID,
    trial_days: 0,
    is_perpetual: true,
    billing_interval: "monthly",
    now: NOW,
  });
}

describe("Subscription plan choice", () => {
  it("is born with the initial plan choice pending", () => {
    const subscription = freeSubscription();

    expect(subscription.plan_chosen_at).toBeNull();
    expect(subscription.needs_plan_choice).toBe(true);
  });

  it("records the choice at the given instant", () => {
    const subscription = freeSubscription();
    const chosenAt = new Date("2026-06-15T12:05:00.000Z");

    subscription.recordPlanChoice(chosenAt);

    expect(subscription.plan_chosen_at).toEqual(chosenAt);
    expect(subscription.needs_plan_choice).toBe(false);
  });

  it("keeps the first choice when recorded again, without touching the subscription", () => {
    const subscription = freeSubscription();
    const firstChoice = new Date("2026-06-15T12:05:00.000Z");
    subscription.recordPlanChoice(firstChoice);
    const updatedAt = subscription.updated_at;

    subscription.recordPlanChoice(new Date("2026-07-01T00:00:00.000Z"));

    expect(subscription.plan_chosen_at).toEqual(firstChoice);
    expect(subscription.updated_at).toEqual(updatedAt);
  });

  it("never changes plan or status when the choice is recorded", () => {
    const subscription = freeSubscription();

    subscription.recordPlanChoice(NOW);

    expect(subscription.plan_id).toBe(PLAN_ID);
    expect(subscription.status).toBe("active");
  });

  it("treats a reconstituted subscription without the field as still pending", () => {
    const subscription = Subscription.reconstitute({
      id: "b3f6c1a0-0000-4000-8000-000000000013",
      user_id: USER_ID,
      plan_id: PLAN_ID,
      status: "active",
      created_at: NOW,
      updated_at: NOW,
    });

    expect(subscription.needs_plan_choice).toBe(true);
  });
});
