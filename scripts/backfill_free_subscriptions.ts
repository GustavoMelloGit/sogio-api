import { eq, isNull } from "drizzle-orm";
import { db } from "../src/core/infra/database/drizzle/database";
import {
  usersTable,
  subscriptionsTable,
} from "../src/core/infra/database/drizzle/schema";
import { BillingDi } from "../src/billing/infra/di/billing_di";

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
