import { z } from "zod";
import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../core/domain/entity/base_entity";
import { subscriptionStatusSchema } from "./subscription";

export const subscriptionHistoryEntryTypeSchema = z.enum([
  "started",
  "plan_changed",
  "payment_failed",
  "canceled",
]);

export type SubscriptionHistoryEntryType = z.infer<
  typeof subscriptionHistoryEntryTypeSchema
>;

export const subscriptionHistoryEntrySchema = baseEntitySchema
  .extend({
    subscription_id: z.uuidv4(),
    user_id: z.uuidv4(),
    plan_id: z.uuidv4(),
    type: subscriptionHistoryEntryTypeSchema,
    resulting_status: subscriptionStatusSchema,
    occurred_at: z.date(),
    access_until: z.date().nullable().optional(),
    reason: z.string().max(255).nullable().optional(),
  })
  .refine(data => !data.reason || data.type === "payment_failed", {
    message: "reason can only be set for a payment_failed entry",
    path: ["reason"],
  })
  .refine(
    data =>
      data.type !== "payment_failed" ||
      (data.resulting_status === "past_due" && !!data.access_until),
    {
      message:
        "a payment_failed entry must have resulting_status past_due and an access_until",
      path: ["resulting_status"],
    }
  )
  .refine(
    data => data.type !== "canceled" || data.resulting_status === "canceled",
    {
      message: "a canceled entry must have resulting_status canceled",
      path: ["resulting_status"],
    }
  )
  .refine(
    data =>
      data.type !== "started" ||
      ["active", "trialing"].includes(data.resulting_status),
    {
      message: "a started entry must have resulting_status active or trialing",
      path: ["resulting_status"],
    }
  );

export type SubscriptionHistoryEntryData = z.infer<
  typeof subscriptionHistoryEntrySchema
>;

/**
 * @kind Entity
 */
export class SubscriptionHistoryEntry {
  readonly #data: SubscriptionHistoryEntryData;

  private constructor(data: SubscriptionHistoryEntryData) {
    this.#data = subscriptionHistoryEntrySchema.parse(data);
  }

  /** The only factory for new entries — this record is append-only, never mutated. */
  public static record(
    data: WithoutBaseEntity<SubscriptionHistoryEntryData>
  ): SubscriptionHistoryEntry {
    return new SubscriptionHistoryEntry({
      ...data,
      id: crypto.randomUUID(),
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  public static reconstitute(
    data: SubscriptionHistoryEntryData
  ): SubscriptionHistoryEntry {
    return new SubscriptionHistoryEntry(data);
  }

  get id() {
    return this.#data.id;
  }

  get subscription_id() {
    return this.#data.subscription_id;
  }

  get user_id() {
    return this.#data.user_id;
  }

  get plan_id() {
    return this.#data.plan_id;
  }

  get type() {
    return this.#data.type;
  }

  get resulting_status() {
    return this.#data.resulting_status;
  }

  get occurred_at() {
    return this.#data.occurred_at;
  }

  get access_until() {
    return this.#data.access_until ?? null;
  }

  get reason() {
    return this.#data.reason ?? null;
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
