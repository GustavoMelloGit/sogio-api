import type { Plan } from "../entity/plan";

export interface PlanRepository {
  planOfId(id: string): Promise<Plan | null>;
  planOfCode(code: string): Promise<Plan | null>;
  /** Resolves a plan by its gateway price reference — the DA-9 webhook mapping. `null` when nothing matches (never throws). */
  planOfExternalPriceReference(reference: string): Promise<Plan | null>;
  allOffered(): Promise<Plan[]>;
  save(plan: Plan): Promise<void>;
}
