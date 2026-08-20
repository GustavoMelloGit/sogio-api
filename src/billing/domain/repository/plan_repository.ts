import type { Plan } from "../entity/plan";

export interface PlanRepository {
  planOfId(id: string): Promise<Plan | null>;
  planOfCode(code: string): Promise<Plan | null>;
  /** Resolves a plan by its gateway price reference — the DA-9 webhook mapping. `null` when nothing matches (never throws). */
  planOfExternalPriceReference(reference: string): Promise<Plan | null>;
  /** Resolves every plan linked to a gateway Product — a product.* event can affect several Prices/plans at once (DA-7). */
  plansOfExternalProductReference(reference: string): Promise<Plan[]>;
  allOffered(): Promise<Plan[]>;
  /** Throws `ConflictError` when `external_price_reference` would collide with a different plan (R-11) — the catalog write path must catch and log this, never let it propagate (DA-4). */
  save(plan: Plan): Promise<void>;
}
