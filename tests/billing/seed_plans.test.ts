import { describe, it, expect } from "bun:test";
import { eq } from "drizzle-orm";
import { seedPlans } from "../helpers/fixtures/plan";
import { db } from "../../src/core/infra/database/drizzle/database";
import { plansTable } from "../../src/core/infra/database/drizzle/schema";
import { PlanPostgresRepository } from "../../src/billing/infra/database/postgres_repository/plan_postgres_repository";

const planRepository = new PlanPostgresRepository();

describe("seedPlans (DA-10 — dev/test fixture only)", () => {
  it("does not duplicate the free or pro plan rows on repeated calls", async () => {
    await seedPlans();
    await seedPlans();

    const free = await planRepository.planOfCode("free");
    const pro = await planRepository.planOfCode("pro");

    expect(free).not.toBeNull();
    expect(pro).not.toBeNull();
  });

  it("never overwrites an already-seeded row — the gateway, not this fixture, owns updates outside test/dev", async () => {
    const pro = await planRepository.planOfCode("pro");
    if (!pro) throw new Error("test setup: pro plan not seeded");

    const original = {
      name: pro.name,
      price_amount: pro.price_amount,
      capabilities: pro.capabilities,
      trial_days: pro.trial_days,
      external_price_reference: pro.external_price_reference,
    };

    await db
      .update(plansTable)
      .set({
        name: "Pro (synced from gateway)",
        price_amount: 3000,
        external_price_reference: "price_from_gateway",
      })
      .where(eq(plansTable.id, pro.id));

    try {
      // seedPlans is `onConflictDoNothing` (no `STRIPE_PRO_PRICE_ID` resync
      // branch anymore, DA-10) — re-running it must leave a gateway-synced
      // row untouched.
      await seedPlans();

      const reloaded = await planRepository.planOfCode("pro");
      expect(reloaded?.name).toBe("Pro (synced from gateway)");
      expect(reloaded?.price_amount).toBe(3000);
      expect(reloaded?.external_price_reference).toBe("price_from_gateway");
    } finally {
      await db
        .update(plansTable)
        .set(original)
        .where(eq(plansTable.id, pro.id));
    }
  });
});
