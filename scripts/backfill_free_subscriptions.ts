import { eq, isNull } from "drizzle-orm";
import { db } from "../src/core/infra/database/drizzle/database";
import {
  usersTable,
  subscriptionsTable,
} from "../src/core/infra/database/drizzle/schema";
import { BillingDi } from "../src/billing/infra/di/billing_di";

/**
 * One-time repair for the accounts caught by the incident this delivery
 * fixes (R-5): `plans` was empty in production, so
 * `EnsureFreeSubscriptionUseCase` couldn't find the `free` plan for any
 * account created during that window, and `StartFreeSubscriptionOnUserCreated`
 * logs and swallows that failure — the signup itself succeeds, but the
 * account is left without a `Subscription`. `SubscriptionAccessPolicy`'s
 * fail-closed gate then blocks it on every authenticated route and `/mcp`,
 * forever, since there is no scheduler retrying anything.
 *
 * Populating the catalog (this delivery's actual fix) does nothing for
 * accounts already in that state — `EnsureFreeSubscriptionUseCase` is
 * idempotent and was written expecting exactly this backfill, but nothing
 * calls it a second time on its own. Run once, manually, after §7.6 of the
 * catalog-sync plan confirms `GET /billing/plans` is populated — running it
 * before that would just re-fail with the same ResourceNotFoundError("Plan").
 *
 * Safe to run more than once: every user already holding a `Subscription`
 * (the free-plan grant this script performs included) is skipped by the
 * query below, and the use case itself is a no-op for a user who already
 * has one.
 */
async function main() {
  const billingDi = new BillingDi();
  const ensureFreeSubscriptionUseCase =
    billingDi.makeEnsureFreeSubscriptionUseCase();

  const usersWithoutSubscription = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .leftJoin(subscriptionsTable, eq(subscriptionsTable.user_id, usersTable.id))
    .where(isNull(subscriptionsTable.id));

  console.log(
    `[backfill] Found ${usersWithoutSubscription.length} user(s) without a Subscription.`
  );

  let succeeded = 0;
  let failed = 0;

  for (const user of usersWithoutSubscription) {
    try {
      await ensureFreeSubscriptionUseCase.execute({ user_id: user.id });
      succeeded += 1;
      console.log(`[backfill] Granted free plan to user ${user.id}`);
    } catch (error) {
      failed += 1;
      console.error(
        `[backfill] Failed to grant free plan to user ${user.id}`,
        error
      );
    }
  }

  console.log(`[backfill] Done. Succeeded: ${succeeded}, failed: ${failed}.`);

  return failed;
}

main()
  .then(failed => process.exit(failed > 0 ? 1 : 0))
  .catch(error => {
    console.error("[backfill] Failed:", error);
    process.exit(1);
  });
