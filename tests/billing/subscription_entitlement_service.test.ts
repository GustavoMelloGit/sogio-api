import { describe, expect, it } from "bun:test";
import { SubscriptionEntitlementService } from "../../src/billing/application/service/subscription_entitlement_service";
import type { SubscriptionRepository } from "../../src/billing/domain/repository/subscription_repository";
import type { PlanRepository } from "../../src/billing/domain/repository/plan_repository";
import { Plan } from "../../src/billing/domain/entity/plan";
import { Subscription } from "../../src/billing/domain/entity/subscription";

const proPlan = Plan.create({
  code: "pro",
  name: "Pro",
  price_amount: 4990,
  billing_interval: "monthly",
  capabilities: { max_properties: 5, export_reports: true, bulk_import: false },
  trial_days: 14,
});

const proSubscription = Subscription.create({
  user_id: "b3f6c1a0-0000-4000-8000-000000000099",
  plan_id: proPlan.id,
  trial_days: proPlan.trial_days,
  is_perpetual: proPlan.is_perpetual,
  billing_interval: proPlan.billing_interval,
});

function makeSubscriptionRepository(
  overrides: Partial<SubscriptionRepository> = {}
): SubscriptionRepository {
  return {
    subscriptionOfUser: () => {
      throw new Error("not implemented in test stub");
    },
    currentSubscriptionWithPlanOfUser: () => Promise.resolve(null),
    subscriptionOfExternalCustomerReference: () => {
      throw new Error("not implemented in test stub");
    },
    subscriptionOfExternalReference: () => {
      throw new Error("not implemented in test stub");
    },
    linkCustomerReferenceIfAbsent: () => {
      throw new Error("not implemented in test stub");
    },
    save: () => {
      throw new Error("not implemented in test stub");
    },
    ...overrides,
  };
}

function makePlanRepository(
  overrides: Partial<PlanRepository> = {}
): PlanRepository {
  return {
    planOfId: () => {
      throw new Error("not implemented in test stub");
    },
    planOfCode: () => Promise.resolve(null),
    planOfExternalPriceReference: () => {
      throw new Error("not implemented in test stub");
    },
    plansOfExternalProductReference: () => {
      throw new Error("not implemented in test stub");
    },
    allOffered: () => {
      throw new Error("not implemented in test stub");
    },
    save: () => {
      throw new Error("not implemented in test stub");
    },
    ...overrides,
  };
}

describe("SubscriptionEntitlementService — no subscription (D-8)", () => {
  it("returns has_platform_access:false, a null plan, and blocked_reason no_subscription when there is no subscription row", async () => {
    const service = new SubscriptionEntitlementService(
      makeSubscriptionRepository(),
      makePlanRepository()
    );

    const entitlement = await service.entitlementOf(
      "b3f6c1a0-0000-4000-8000-000000000001"
    );

    expect(entitlement.has_platform_access).toBe(false);
    expect(entitlement.plan).toBeNull();
    expect(entitlement.blocked_reason).toBe("no_subscription");
  });

  it("returns an empty capability set, not the registry defaults a Free account would get", async () => {
    const service = new SubscriptionEntitlementService(
      makeSubscriptionRepository(),
      makePlanRepository()
    );

    const entitlement = await service.entitlementOf(
      "b3f6c1a0-0000-4000-8000-000000000001"
    );

    expect(entitlement.capabilities.limitOf("max_properties")).toBe(0);
    expect(entitlement.capabilities.allows("export_reports")).toBe(false);
  });

  it("also falls back to no-subscription when a current subscription exists but the free plan is missing from the catalog", async () => {
    const service = new SubscriptionEntitlementService(
      makeSubscriptionRepository({
        currentSubscriptionWithPlanOfUser: () =>
          Promise.resolve({ subscription: proSubscription, plan: proPlan }),
      }),
      makePlanRepository({ planOfCode: () => Promise.resolve(null) })
    );

    const entitlement = await service.entitlementOf(proSubscription.user_id);

    expect(entitlement.has_platform_access).toBe(false);
    expect(entitlement.blocked_reason).toBe("no_subscription");
    expect(entitlement.capabilities.limitOf("max_properties")).toBe(0);
  });
});
