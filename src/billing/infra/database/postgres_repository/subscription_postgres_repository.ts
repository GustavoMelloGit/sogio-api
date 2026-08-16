import { eq } from "drizzle-orm";
import {
  Subscription,
  type SubscriptionStatus,
} from "../../../domain/entity/subscription";
import { Plan, type BillingInterval } from "../../../domain/entity/plan";
import type {
  SubscriptionRepository,
  SubscriptionWithPlan,
} from "../../../domain/repository/subscription_repository";
import { db } from "../../../../core/infra/database/drizzle/database";
import { subscriptionsTable } from "../../../../core/infra/database/drizzle/schema";

export class SubscriptionPostgresRepository implements SubscriptionRepository {
  async subscriptionOfUser(user_id: string): Promise<Subscription | null> {
    const subscription = await db.query.subscriptionsTable.findFirst({
      where: eq(subscriptionsTable.user_id, user_id),
    });

    if (!subscription) return null;

    return this.#toEntity(subscription);
  }

  async currentSubscriptionWithPlanOfUser(
    user_id: string
  ): Promise<SubscriptionWithPlan | null> {
    const row = await db.query.subscriptionsTable.findFirst({
      where: eq(subscriptionsTable.user_id, user_id),
      with: { plan: true },
    });

    if (!row) return null;

    return {
      subscription: this.#toEntity(row),
      plan: Plan.reconstitute({
        ...row.plan,
        billing_interval: row.plan.billing_interval as BillingInterval,
      }),
    };
  }

  async save(subscription: Subscription): Promise<void> {
    const existing = await db.query.subscriptionsTable.findFirst({
      where: eq(subscriptionsTable.id, subscription.id),
    });

    const data = {
      id: subscription.id,
      user_id: subscription.user_id,
      plan_id: subscription.plan_id,
      status: subscription.status,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
      trial_ends_at: subscription.trial_ends_at,
      canceled_at: subscription.canceled_at,
      grace_period_ends_at: subscription.grace_period_ends_at,
      external_reference: subscription.external_reference,
      external_customer_reference: subscription.external_customer_reference,
      created_at: subscription.created_at,
      updated_at: subscription.updated_at,
      deleted_at: subscription.deleted_at,
    };

    if (existing) {
      await db
        .update(subscriptionsTable)
        .set(data)
        .where(eq(subscriptionsTable.id, subscription.id));
      return;
    }

    await db.insert(subscriptionsTable).values(data);
  }

  #toEntity(row: typeof subscriptionsTable.$inferSelect): Subscription {
    return Subscription.reconstitute({
      ...row,
      status: row.status as SubscriptionStatus,
    });
  }
}
