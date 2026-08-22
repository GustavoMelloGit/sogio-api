import { z } from "zod";
import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../core/domain/entity/base_entity";

export const billingIntervalSchema = z.enum(["monthly"]);

export type BillingInterval = z.infer<typeof billingIntervalSchema>;

export const planCapabilitiesSchema = z.record(
  z.string().max(100),
  z.unknown()
);

export type PlanCapabilities = z.infer<typeof planCapabilitiesSchema>;

export const planSchema = baseEntitySchema.extend({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  price_amount: z.int().min(0).max(100_000_000),
  billing_interval: billingIntervalSchema,
  capabilities: planCapabilitiesSchema,
  trial_days: z.int().min(0).max(365),
  external_price_reference: z.string().max(255).nullable().optional(),

  external_product_reference: z.string().max(255).nullable().optional(),

  external_event_at: z.date().nullable().optional(),
});

export type PlanData = z.infer<typeof planSchema>;

export type PlanCatalogSync = {
  name: string;
  price_amount: number;
  billing_interval: BillingInterval;
  capabilities: PlanCapabilities;
  trial_days: number;
  external_price_reference: string;
  external_product_reference: string | null;

  is_offered: boolean;
};

export class Plan {
  #data: PlanData;

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

  syncFromCatalog(entry: PlanCatalogSync, external_event_at: Date): void {
    this.#data.name = entry.name;
    this.#data.price_amount = entry.price_amount;
    this.#data.billing_interval = entry.billing_interval;
    this.#data.capabilities = entry.capabilities;
    this.#data.trial_days = entry.trial_days;
    this.#data.external_price_reference = entry.external_price_reference;
    this.#data.external_product_reference = entry.external_product_reference;
    this.#data.deleted_at = entry.is_offered
      ? null
      : (this.#data.deleted_at ?? external_event_at);
    this.#data.external_event_at = external_event_at;
    this.#touch();
  }

  retire(external_event_at: Date): void {
    this.#data.deleted_at = this.#data.deleted_at ?? external_event_at;
    this.#data.external_event_at = external_event_at;
    this.#touch();
  }

  restore(external_event_at: Date): void {
    this.#data.deleted_at = null;
    this.#data.external_event_at = external_event_at;
    this.#touch();
  }

  #touch(): void {
    this.#data.updated_at = new Date();
    this.#data = planSchema.parse(this.#data);
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

  get capabilities() {
    return { ...this.#data.capabilities };
  }

  get trial_days() {
    return this.#data.trial_days;
  }

  get external_price_reference() {
    return this.#data.external_price_reference ?? null;
  }

  get external_product_reference() {
    return this.#data.external_product_reference ?? null;
  }

  get external_event_at() {
    return this.#data.external_event_at ?? null;
  }

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
