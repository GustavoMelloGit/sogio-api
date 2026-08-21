import { db } from "../../../src/core/infra/database/drizzle/database";
import { plansTable } from "../../../src/core/infra/database/drizzle/schema";

export const FREE_PLAN_ID = "00000000-0000-4000-8000-000000000001";
export const PRO_PLAN_ID = "00000000-0000-4000-8000-000000000002";

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

  await db
    .insert(plansTable)
    .values({
      id: PRO_PLAN_ID,
      code: "pro",
      name: "Pro",
      price_amount: 2500,
      billing_interval: "monthly",
      max_properties: 5,
      trial_days: 14,
    })
    .onConflictDoNothing({ target: plansTable.code });
}
