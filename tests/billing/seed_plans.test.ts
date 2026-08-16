import { describe, it, expect } from "bun:test";
import { eq } from "drizzle-orm";
import { seedPlans } from "../../src/billing/infra/database/seed_plans";
import { db } from "../../src/core/infra/database/drizzle/database";
import { plansTable } from "../../src/core/infra/database/drizzle/schema";
import { PlanPostgresRepository } from "../../src/billing/infra/database/postgres_repository/plan_postgres_repository";
import { env } from "../../src/core/infra/config/environments";

const planRepository = new PlanPostgresRepository();

describe("seedPlans (DA-11)", () => {
  it("is idempotent and never nulls out an already-set external_price_reference without STRIPE_PRO_PRICE_ID", async () => {
    const pro = await planRepository.planOfCode("pro");
    if (!pro) throw new Error("test setup: pro plan not seeded");

    await db
      .update(plansTable)
      .set({ external_price_reference: "price_manually_set" })
      .where(eq(plansTable.id, pro.id));

    try {
      // STRIPE_PRO_PRICE_ID is unset in .env.test — re-running the seed
      // must take the onConflictDoNothing branch and leave the manually
      // set reference untouched.
      await seedPlans();

      const reloaded = await planRepository.planOfCode("pro");
      expect(reloaded?.external_price_reference).toBe("price_manually_set");
    } finally {
      await db
        .update(plansTable)
        .set({ external_price_reference: null })
        .where(eq(plansTable.id, pro.id));
    }
  });

  it("does not duplicate the free or pro plan rows on repeated calls", async () => {
    await seedPlans();
    await seedPlans();

    const free = await planRepository.planOfCode("free");
    const pro = await planRepository.planOfCode("pro");

    expect(free).not.toBeNull();
    expect(pro).not.toBeNull();
  });

  it("resyncs price_amount, max_properties and trial_days onto the existing pro row when STRIPE_PRO_PRICE_ID is set", async () => {
    const pro = await planRepository.planOfCode("pro");
    if (!pro) throw new Error("test setup: pro plan not seeded");

    const originalStripeProPriceId = env.STRIPE_PRO_PRICE_ID;

    // First run: seed a stale row with values that no longer match the
    // current code — simulates the plan having been seeded before a price
    // or limits change shipped.
    env.STRIPE_PRO_PRICE_ID = "price_stale_test";
    await db
      .update(plansTable)
      .set({ price_amount: 9999, max_properties: 1, trial_days: 0 })
      .where(eq(plansTable.id, pro.id));

    try {
      // Second run: a different STRIPE_PRO_PRICE_ID plus the code's current
      // price/limits must overwrite every stale field on the existing row.
      env.STRIPE_PRO_PRICE_ID = "price_current_test";
      await seedPlans();

      const reloaded = await planRepository.planOfCode("pro");
      expect(reloaded?.price_amount).toBe(2500);
      expect(reloaded?.max_properties).toBe(5);
      expect(reloaded?.trial_days).toBe(14);
      expect(reloaded?.external_price_reference).toBe("price_current_test");
    } finally {
      env.STRIPE_PRO_PRICE_ID = originalStripeProPriceId;
      await db
        .update(plansTable)
        .set({
          price_amount: pro.price_amount,
          max_properties: pro.max_properties,
          trial_days: pro.trial_days,
          external_price_reference: pro.external_price_reference,
        })
        .where(eq(plansTable.id, pro.id));
    }
  });
});
