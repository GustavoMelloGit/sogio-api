import type { UseCase } from "../../../core/application/use_case/use_case";
import type { PlanRepository } from "../../domain/repository/plan_repository";
import type { BillingInterval } from "../../domain/entity/plan";
import { CapabilitySet } from "../../domain/capability/capability_set";
import type { CapabilityKey } from "../../domain/capability/capability_key";

type Input = Record<string, never>;

type PlanDto = {
  id: string;
  code: string;
  name: string;
  price_amount: number;
  billing_interval: BillingInterval;
  capabilities: Record<CapabilityKey, boolean | number>;
  trial_days: number;
  external_price_reference: string | null;
};

type Output = PlanDto[];

export class ListPlansUseCase implements UseCase<Input, Output> {
  constructor(private readonly planRepository: PlanRepository) {}

  async execute(): Promise<Output> {
    const plans = await this.planRepository.allOffered();

    return plans.map(plan => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      price_amount: plan.price_amount,
      billing_interval: plan.billing_interval,
      capabilities: CapabilitySet.of(plan.capabilities).toRecord(),
      trial_days: plan.trial_days,
      external_price_reference: plan.external_price_reference,
    }));
  }
}
