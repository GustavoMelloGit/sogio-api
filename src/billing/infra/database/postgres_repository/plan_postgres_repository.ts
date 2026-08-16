import { eq, isNull } from "drizzle-orm";
import { Plan, type BillingInterval } from "../../../domain/entity/plan";
import type { PlanRepository } from "../../../domain/repository/plan_repository";
import { db } from "../../../../core/infra/database/drizzle/database";
import { plansTable } from "../../../../core/infra/database/drizzle/schema";

export class PlanPostgresRepository implements PlanRepository {
  async planOfId(id: string): Promise<Plan | null> {
    const plan = await db.query.plansTable.findFirst({
      where: eq(plansTable.id, id),
    });

    if (!plan) return null;

    return this.#toEntity(plan);
  }

  async planOfCode(code: string): Promise<Plan | null> {
    const plan = await db.query.plansTable.findFirst({
      where: eq(plansTable.code, code),
    });

    if (!plan) return null;

    return this.#toEntity(plan);
  }

  async planOfExternalPriceReference(reference: string): Promise<Plan | null> {
    const plan = await db.query.plansTable.findFirst({
      where: eq(plansTable.external_price_reference, reference),
    });

    if (!plan) return null;

    return this.#toEntity(plan);
  }

  async allOffered(): Promise<Plan[]> {
    const plans = await db.query.plansTable.findMany({
      where: isNull(plansTable.deleted_at),
    });

    return plans.map(plan => this.#toEntity(plan));
  }

  async save(plan: Plan): Promise<void> {
    const existing = await db.query.plansTable.findFirst({
      where: eq(plansTable.id, plan.id),
    });

    const data = {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      price_amount: plan.price_amount,
      billing_interval: plan.billing_interval,
      max_properties: plan.max_properties,
      trial_days: plan.trial_days,
      external_price_reference: plan.external_price_reference,
      created_at: plan.created_at,
      updated_at: plan.updated_at,
      deleted_at: plan.deleted_at,
    };

    if (existing) {
      await db.update(plansTable).set(data).where(eq(plansTable.id, plan.id));
      return;
    }

    await db.insert(plansTable).values(data);
  }

  #toEntity(row: typeof plansTable.$inferSelect): Plan {
    return Plan.reconstitute({
      ...row,
      billing_interval: row.billing_interval as BillingInterval,
    });
  }
}
