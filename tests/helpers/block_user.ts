import { SubscriptionPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";

const subscriptionRepository = new SubscriptionPostgresRepository();

/** Puts a fixture user's Free subscription into a blocked state (DA-9). */
export async function blockUser(userId: string): Promise<void> {
  const subscription = await subscriptionRepository.subscriptionOfUser(userId);
  if (!subscription) {
    throw new Error("test setup: fixture user has no subscription");
  }

  const alreadyExpiredGrace = new Date(Date.now() - 60 * 60 * 1000);
  subscription.markPastDue(alreadyExpiredGrace);
  await subscriptionRepository.save(subscription);
}
