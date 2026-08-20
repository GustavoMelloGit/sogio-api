import { db } from "../../../core/infra/database/drizzle/database";
import { plansTable } from "../../../core/infra/database/drizzle/schema";

/**
 * Fixed so `code` conflicts resolve deterministically across environments.
 * Must be valid v4 UUIDs (version nibble `4`, variant nibble `8`) — every
 * entity's `id` is validated against `z.uuidv4()` on `reconstitute`.
 */
export const FREE_PLAN_ID = "00000000-0000-4000-8000-000000000001";
export const PRO_PLAN_ID = "00000000-0000-4000-8000-000000000002";

/**
 * Dev/test fixture only (DA-10) — not a production mechanism, and never
 * part of `deploy.yml`. Everywhere else, the gateway owns the catalog
 * (`SyncPlanCatalogEntryUseCase`, `ReconcilePlanCatalogFromGatewayUseCase`):
 * `test` never talks to the network and `development` has no
 * `STRIPE_SECRET_KEY`, so neither environment can populate `plans` any
 * other way. `free` is a hard pre-condition of user registration
 * (`EnsureFreeSubscriptionUseCase`), so both environments need it to exist
 * regardless. Idempotent: `db:push:test` applies the schema but never
 * migration SQL, so this must be runnable on its own in every environment,
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
