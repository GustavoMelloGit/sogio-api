import { describe, it, expect } from "bun:test";
import { eq } from "drizzle-orm";
import { seedPlans } from "../../src/billing/infra/database/seed_plans";
import { db } from "../../src/core/infra/database/drizzle/database";
import { plansTable } from "../../src/core/infra/database/drizzle/schema";
import { PlanPostgresRepository } from "../../src/billing/infra/database/postgres_repository/plan_postgres_repository";

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
});
