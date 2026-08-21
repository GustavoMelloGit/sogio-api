import type { Plan } from "../entity/plan";

export interface PlanRepository {
  planOfId(id: string): Promise<Plan | null>;
  planOfCode(code: string): Promise<Plan | null>;

  planOfExternalPriceReference(reference: string): Promise<Plan | null>;

  plansOfExternalProductReference(reference: string): Promise<Plan[]>;
  allOffered(): Promise<Plan[]>;

  save(plan: Plan): Promise<void>;
}
