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
  price_amount: z.int().min(0).max(100_000_000),
  billing_interval: billingIntervalSchema,
  max_properties: z.int().min(1).max(10_000),
  trial_days: z.int().min(0).max(365),
  external_price_reference: z.string().max(255).nullable().optional(),
  // Not unique: several Prices can belong to the same Product (§2.4).
  external_product_reference: z.string().max(255).nullable().optional(),
  /** Instant, in the gateway's clock, of the last catalog event applied — the DA-1/§2.4 out-of-order guard for the catalog. */
  external_event_at: z.date().nullable().optional(),
});

export type PlanData = z.infer<typeof planSchema>;

/**
 * The fields a gateway catalog entry contributes to a `Plan` (DA-7).
 * Deliberately mirrors `GatewayCatalogEntry`'s shape without importing it —
 * domain never depends on application (mirrors `Subscription`'s
 * `ActivateInput`, filled in by the use case from `GatewayBillingEvent`).
 */
export type PlanCatalogSync = {
  name: string;
  price_amount: number;
  billing_interval: BillingInterval;
  max_properties: number;
  trial_days: number;
  external_price_reference: string;
  external_product_reference: string | null;
  /** Whether the gateway currently offers this entry — the explicit signal I-3 requires before retiring or restoring. */
  is_offered: boolean;
};

/**
 * @kind Entity, Aggregate Root
 */
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

  /**
   * Applies a gateway catalog entry to this plan (DA-7). Never writes
   * `code` (I-1) — the caller has already matched on it, and the identity
   * of a catalog plan never moves. Idempotent and total: never throws
   * (DA-4). Un-retires (`deleted_at = null`) when `is_offered` is true;
   * retires it (once, keeping the original instant) when false. Staleness
   * against `external_event_at` must be checked by the caller before
   * calling this — the entity has no notion of "now" beyond its own
   * last-applied stamp (mirrors `isStaleGatewayEvent` for subscriptions).
   */
  syncFromCatalog(entry: PlanCatalogSync, external_event_at: Date): void {
    this.#data.name = entry.name;
    this.#data.price_amount = entry.price_amount;
    this.#data.billing_interval = entry.billing_interval;
    this.#data.max_properties = entry.max_properties;
    this.#data.trial_days = entry.trial_days;
    this.#data.external_price_reference = entry.external_price_reference;
    this.#data.external_product_reference = entry.external_product_reference;
    this.#data.deleted_at = entry.is_offered
      ? null
      : (this.#data.deleted_at ?? external_event_at);
    this.#data.external_event_at = external_event_at;
    this.#touch();
  }

  /**
   * Retires the plan (DA-7): fills `deleted_at`. Idempotent — already
   * retired is a silent no-op that keeps the original instant, never a
   * `ConflictError` (DA-4). Never touches `code` (I-1).
   */
  retire(external_event_at: Date): void {
    this.#data.deleted_at = this.#data.deleted_at ?? external_event_at;
    this.#data.external_event_at = external_event_at;
    this.#touch();
  }

  /**
   * The inverse of `retire` (DA-7's "des-aposenta"): clears `deleted_at`.
   * Idempotent — already offered is a silent no-op. Used by the
   * Product-driven path (`catalog_product_offering_changed`), which carries
   * no business fields (§2.3) to route through `syncFromCatalog`.
   */
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

  get max_properties() {
    return this.#data.max_properties;
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
