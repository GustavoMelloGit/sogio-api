import { db } from "../../../core/infra/database/drizzle/database";
import { plansTable } from "../../../core/infra/database/drizzle/schema";
import { env } from "../../../core/infra/config/environments";

/**
 * Fixed so `code` conflicts resolve deterministically across environments.
 * Must be valid v4 UUIDs (version nibble `4`, variant nibble `8`) — every
 * entity's `id` is validated against `z.uuidv4()` on `reconstitute`.
 */
export const FREE_PLAN_ID = "00000000-0000-4000-8000-000000000001";
export const PRO_PLAN_ID = "00000000-0000-4000-8000-000000000002";

/**
 * Idempotent (DA-12): `free` is a hard pre-condition of user registration,
 * and `db:push:test` applies the schema without ever running this
 * migration's SQL, so this must be runnable on its own in every environment,
 * including the test suite's bootstrap.
 */
export async function seedPlans(): Promise<void> {
  await db
    .insert(plansTable)
    .values({
      id: FREE_PLAN_ID,
      code: "free",
      name: "Free",
      price_amount: 0,
      billing_interval: "monthly",
      max_properties: 1,
      trial_days: 0,
    })
    .onConflictDoNothing({ target: plansTable.code });

  const proPlan = {
    id: PRO_PLAN_ID,
    code: "pro",
    name: "Pro",
    price_amount: 4990,
    billing_interval: "monthly",
    max_properties: 5,
    // Trial administered by the gateway (Q-1, §2.5) — kept at 14 days.
    trial_days: 14,
    external_price_reference: env.STRIPE_PRO_PRICE_ID ?? null,
  };

  if (env.STRIPE_PRO_PRICE_ID) {
    // DA-11: catalog sync is manual, but re-running the seed after setting
    // STRIPE_PRO_PRICE_ID must still backfill it onto the existing row —
    // onConflictDoNothing would leave it null forever.
    await db
      .insert(plansTable)
      .values(proPlan)
      .onConflictDoUpdate({
        target: plansTable.code,
        set: { external_price_reference: proPlan.external_price_reference },
      });
    return;
  }

  await db
    .insert(plansTable)
    .values(proPlan)
    .onConflictDoNothing({ target: plansTable.code });
}
