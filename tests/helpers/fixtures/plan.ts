import { db } from "../../../src/core/infra/database/drizzle/database";
import {
  plansTable,
  subscriptionsTable,
} from "../../../src/core/infra/database/drizzle/schema";
import { eq } from "drizzle-orm";

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
      capabilities: { max_properties: 1 },
      trial_days: 0,
    })
    .onConflictDoUpdate({
      target: plansTable.code,
      set: { capabilities: { max_properties: 1 }, trial_days: 0 },
    });

  await db
    .insert(plansTable)
    .values({
      id: PRO_PLAN_ID,
      code: "pro",
      name: "Pro",
      price_amount: 2500,
      billing_interval: "monthly",
      capabilities: { max_properties: 5, bulk_import: true },
      trial_days: 14,
    })
    .onConflictDoUpdate({
      target: plansTable.code,
      set: {
        capabilities: { max_properties: 5, bulk_import: true },
        trial_days: 14,
      },
    });
}

export async function upgradeToPro(userId: string): Promise<void> {
  await db
    .update(subscriptionsTable)
    .set({ plan_id: PRO_PLAN_ID })
    .where(eq(subscriptionsTable.user_id, userId));
}

export async function assignPlanWithCapabilities(
  userId: string,
  code: string,
  capabilities: Record<string, number | boolean>
): Promise<void> {
  const [plan] = await db
    .insert(plansTable)
    .values({
      id: crypto.randomUUID(),
      code,
      name: code,
      price_amount: 100,
      billing_interval: "monthly",
      capabilities,
      trial_days: 0,
    })
    .onConflictDoUpdate({ target: plansTable.code, set: { capabilities } })
    .returning({ id: plansTable.id });

  if (!plan) {
    throw new Error(`Failed to upsert plan ${code}`);
  }

  await db
    .update(subscriptionsTable)
    .set({ plan_id: plan.id })
    .where(eq(subscriptionsTable.user_id, userId));
}
