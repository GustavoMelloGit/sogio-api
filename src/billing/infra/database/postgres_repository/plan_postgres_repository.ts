import { eq, isNull } from "drizzle-orm";
import { Plan, type BillingInterval } from "../../../domain/entity/plan";
import type { PlanRepository } from "../../../domain/repository/plan_repository";
import { db } from "../../../../core/infra/database/drizzle/database";
import { plansTable } from "../../../../core/infra/database/drizzle/schema";
import { ConflictError } from "../../../../core/application/error/conflict_error";
import { ValidationError } from "../../../../core/application/error/validation_error";

function pgErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if ("code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object" && "code" in cause) {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function classifyWriteFailure(
  error: unknown
): "unique_violation" | "invalid_data" | null {
  const code = pgErrorCode(error);
  if (!code) return null;
  if (code === "23505") return "unique_violation";
  if (code.startsWith("22") || code === "23502" || code === "23514") {
    return "invalid_data";
  }
  return null;
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
      const classification = classifyWriteFailure(error);

      if (classification === "unique_violation") {
        throw new ConflictError(
          "Plan external_price_reference already linked to another plan"
        );
      }

      if (classification === "invalid_data") {
        throw new ValidationError(
          "Plan write rejected by the database as invalid data"
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
