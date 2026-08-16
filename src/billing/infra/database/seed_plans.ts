import { db } from "../../../core/infra/database/drizzle/database";
import { plansTable } from "../../../core/infra/database/drizzle/schema";

/** Fixed so `code` conflicts resolve deterministically across environments. */
export const FREE_PLAN_ID = "00000000-0000-0000-0000-000000000001";
export const PRO_PLAN_ID = "00000000-0000-0000-0000-000000000002";

/**
 * Idempotent (DA-12): `free` is a hard pre-condition of user registration,
 * and `db:push:test` applies the schema without ever running this
 * migration's SQL, so this must be runnable on its own in every environment,
 * including the test suite's bootstrap.
 */
export async function seedPlans(): Promise<void> {
  await db
    .insert(plansTable)
    .values([
      {
        id: FREE_PLAN_ID,
        code: "free",
        name: "Free",
        price_amount: 0,
        billing_interval: "monthly",
        max_properties: 1,
        trial_days: 0,
      },
      {
        id: PRO_PLAN_ID,
        code: "pro",
        name: "Pro",
        price_amount: 4990,
        billing_interval: "monthly",
        max_properties: 5,
        trial_days: 14,
      },
    ])
    .onConflictDoNothing({ target: plansTable.code });
}
