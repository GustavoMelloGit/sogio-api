import { and, eq, isNull } from "drizzle-orm";
import {
  Subscription,
  type SubscriptionStatus,
} from "../../../domain/entity/subscription";
import {
  Plan,
  type BillingInterval,
  type PlanCapabilities,
} from "../../../domain/entity/plan";
import type {
  SubscriptionRepository,
  SubscriptionWithPlan,
} from "../../../domain/repository/subscription_repository";
import { IllegalStateError } from "../../../../core/application/error/illegal_state_error";
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
        capabilities: row.plan.capabilities as PlanCapabilities,
      }),
    };
  }

  async subscriptionOfExternalCustomerReference(
    reference: string
  ): Promise<Subscription | null> {
    const subscription = await db.query.subscriptionsTable.findFirst({
      where: eq(subscriptionsTable.external_customer_reference, reference),
    });

    if (!subscription) return null;

    return this.#toEntity(subscription);
  }

  async subscriptionOfExternalReference(
    reference: string
  ): Promise<Subscription | null> {
    const subscription = await db.query.subscriptionsTable.findFirst({
      where: eq(subscriptionsTable.external_reference, reference),
    });

    if (!subscription) return null;

    return this.#toEntity(subscription);
  }

  async linkCustomerReferenceIfAbsent(
    subscription_id: string,
    reference: string
  ): Promise<string> {
    const updated = await db
      .update(subscriptionsTable)
      .set({
        external_customer_reference: reference,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(subscriptionsTable.id, subscription_id),
          isNull(subscriptionsTable.external_customer_reference)
        )
      )
      .returning({
        external_customer_reference:
          subscriptionsTable.external_customer_reference,
      });

    if (updated[0]?.external_customer_reference) {
      return updated[0].external_customer_reference;
    }

    const existing = await db.query.subscriptionsTable.findFirst({
      where: eq(subscriptionsTable.id, subscription_id),
      columns: { external_customer_reference: true },
    });

    if (!existing?.external_customer_reference) {
      throw new IllegalStateError(
        "linkCustomerReferenceIfAbsent found no customer reference after a no-op atomic update"
      );
    }

    return existing.external_customer_reference;
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
      external_event_at: subscription.external_event_at,
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
