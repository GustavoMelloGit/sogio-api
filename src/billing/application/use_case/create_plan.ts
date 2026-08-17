import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../../auth/domain/entity/user";
import { ConflictError } from "../../../core/application/error/conflict_error";
import { ForbiddenError } from "../../../core/application/error/forbidden_error";
import type { PlanRepository } from "../../domain/repository/plan_repository";
import { Plan, type BillingInterval } from "../../domain/entity/plan";

type Input = {
  code: string;
  name: string;
  price_amount: number;
  billing_interval: BillingInterval;
  max_properties: number;
  trial_days: number;
  external_price_reference?: string | null;
};

type Output = {
  id: string;
  code: string;
  name: string;
  price_amount: number;
  billing_interval: BillingInterval;
  max_properties: number;
  trial_days: number;
  external_price_reference: string | null;
  created_at: Date;
  updated_at: Date;
};

export class CreatePlanUseCase implements UseCase<Input, Output> {
  constructor(private readonly planRepository: PlanRepository) {}

  async execute(input: Input, user: User): Promise<Output> {
    if (user.role !== "admin") {
      throw new ForbiddenError();
    }

    const existing = await this.planRepository.planOfCode(input.code);
    if (existing) {
      throw new ConflictError(`Plan with code "${input.code}" already exists`);
    }

    const plan = Plan.create(input);
    await this.planRepository.save(plan);

    return {
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
    };
  }
}
