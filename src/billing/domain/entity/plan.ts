import { z } from "zod";
import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../core/domain/entity/base_entity";

export const billingIntervalSchema = z.enum(["monthly"]);

export type BillingInterval = z.infer<typeof billingIntervalSchema>;

export const planSchema = baseEntitySchema.extend({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  price_amount: z.int().min(0),
  billing_interval: billingIntervalSchema,
  max_properties: z.int().min(1),
  trial_days: z.int().min(0),
  external_price_reference: z.string().nullable().optional(),
});

export type PlanData = z.infer<typeof planSchema>;

/**
 * @kind Entity, Aggregate Root
 */
export class Plan {
  readonly #data: PlanData;

  private constructor(data: PlanData) {
    this.#data = planSchema.parse(data);
  }

  public static create(data: WithoutBaseEntity<PlanData>): Plan {
    return new Plan({
      ...data,
      id: crypto.randomUUID(),
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  public static reconstitute(data: PlanData): Plan {
    return new Plan(data);
  }

  get id() {
    return this.#data.id;
  }

  get code() {
    return this.#data.code;
  }

  get name() {
    return this.#data.name;
  }

  get price_amount() {
    return this.#data.price_amount;
  }

  get billing_interval() {
    return this.#data.billing_interval;
  }

  get max_properties() {
    return this.#data.max_properties;
  }

  get trial_days() {
    return this.#data.trial_days;
  }

  get external_price_reference() {
    return this.#data.external_price_reference ?? null;
  }

  /** `price_amount = 0` marks a perpetual plan — no billing cycle. */
  get is_perpetual() {
    return this.#data.price_amount === 0;
  }

  get created_at() {
    return this.#data.created_at;
  }

  get updated_at() {
    return this.#data.updated_at;
  }

  get deleted_at() {
    return this.#data.deleted_at;
  }
}
