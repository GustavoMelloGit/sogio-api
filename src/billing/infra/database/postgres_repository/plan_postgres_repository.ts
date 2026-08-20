import { eq, isNull } from "drizzle-orm";
import { Plan, type BillingInterval } from "../../../domain/entity/plan";
import type { PlanRepository } from "../../../domain/repository/plan_repository";
import { db } from "../../../../core/infra/database/drizzle/database";
import { plansTable } from "../../../../core/infra/database/drizzle/schema";
import { ConflictError } from "../../../../core/application/error/conflict_error";

/**
 * Drizzle wraps the driver error in `DrizzleQueryError`, whose own `.code`
 * is undefined — the pg error (and its `23505` code) lives one level down,
 * in `.cause`. Checked at both levels so this survives either shape.
 */
function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ("code" in error && (error as { code?: string }).code === "23505") {
    return true;
  }
  const cause = (error as { cause?: unknown }).cause;
  return (
    !!cause &&
    typeof cause === "object" &&
    "code" in cause &&
    (cause as { code?: string }).code === "23505"
  );
}

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

  async plansOfExternalProductReference(reference: string): Promise<Plan[]> {
    const plans = await db.query.plansTable.findMany({
      where: eq(plansTable.external_product_reference, reference),
    });

    return plans.map(plan => this.#toEntity(plan));
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
      external_product_reference: plan.external_product_reference,
      external_event_at: plan.external_event_at,
      created_at: plan.created_at,
      updated_at: plan.updated_at,
      deleted_at: plan.deleted_at,
    };

    try {
      if (existing) {
        await db.update(plansTable).set(data).where(eq(plansTable.id, plan.id));
        return;
      }

      await db.insert(plansTable).values(data);
    } catch (error) {
      // R-11: a repointed/created plan colliding on external_price_reference
      // is a recognized outcome of catalog sync (two Prices declaring the
      // same code, or two plans somehow pointing at the same price), not an
      // infrastructure failure — surfaced as ConflictError so the catalog
      // write path (DA-4) can catch it and log a refusal instead of
      // propagating, the same way the gateway's own retry would.
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          "Plan external_price_reference already linked to another plan"
        );
      }
      throw error;
    }
  }

  #toEntity(row: typeof plansTable.$inferSelect): Plan {
    return Plan.reconstitute({
      ...row,
      billing_interval: row.billing_interval as BillingInterval,
    });
  }
}
