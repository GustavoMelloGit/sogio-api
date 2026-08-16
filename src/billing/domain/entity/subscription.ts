import { z } from "zod";
import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../core/domain/entity/base_entity";
import { ConflictError } from "../../../core/application/error/conflict_error";
import { ValidationError } from "../../../core/application/error/validation_error";
import { BillingCyclePolicy } from "../policy/billing_cycle_policy";
import type { BillingInterval } from "./plan";

export const subscriptionStatusSchema = z.enum([
  "trialing",
  "active",
  "past_due",
  "canceled",
]);

export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export const subscriptionSchema = baseEntitySchema
  .extend({
    user_id: z.uuidv4(),
    plan_id: z.uuidv4(),
    status: subscriptionStatusSchema,
    current_period_start: z.date().nullable().optional(),
    current_period_end: z.date().nullable().optional(),
    trial_ends_at: z.date().nullable().optional(),
    canceled_at: z.date().nullable().optional(),
    grace_period_ends_at: z.date().nullable().optional(),
    external_reference: z.string().nullable().optional(),
    external_customer_reference: z.string().nullable().optional(),
    /** Instant, in the gateway's clock, of the last gateway event applied — the DA-8 out-of-order guard. */
    external_event_at: z.date().nullable().optional(),
  })
  .refine(data => data.status !== "trialing" || !!data.trial_ends_at, {
    message: "trial_ends_at is required while status is trialing",
    path: ["trial_ends_at"],
  })
  .refine(data => data.status !== "past_due" || !!data.grace_period_ends_at, {
    message: "grace_period_ends_at is required while status is past_due",
    path: ["grace_period_ends_at"],
  })
  .refine(data => data.status !== "canceled" || !!data.canceled_at, {
    message: "canceled_at is required while status is canceled",
    path: ["canceled_at"],
  });

export type SubscriptionData = z.infer<typeof subscriptionSchema>;

type ActivateInput = {
  is_perpetual: boolean;
  billing_interval?: BillingInterval;
  now?: Date;
  /** Supplied by the gateway (§2.3): when set, used literally and `BillingCyclePolicy` is never consulted. */
  period_end?: Date;
  external_reference?: string | null;
  external_event_at?: Date;
};

type ChangePlanInput = {
  plan_id: string;
  trial_days: number;
  is_perpetual: boolean;
  billing_interval: BillingInterval;
  now?: Date;
  period_end?: Date;
  external_reference?: string | null;
  external_event_at?: Date;
};

/**
 * @kind Entity, Aggregate Root
 */
export class Subscription {
  #data: SubscriptionData;

  private constructor(data: SubscriptionData) {
    this.#data = subscriptionSchema.parse(data);
  }

  /** Builds the initial Subscription for a user against `plan`'s terms. */
  public static create(
    input: WithoutBaseEntity<{
      user_id: string;
      plan_id: string;
      trial_days: number;
      is_perpetual: boolean;
      billing_interval: BillingInterval;
    }> & { now?: Date }
  ): Subscription {
    const now = input.now ?? new Date();

    const subscription = new Subscription({
      id: crypto.randomUUID(),
      user_id: input.user_id,
      plan_id: input.plan_id,
      status: "active",
      current_period_start: null,
      current_period_end: null,
      trial_ends_at: null,
      canceled_at: null,
      grace_period_ends_at: null,
      external_reference: null,
      external_customer_reference: null,
      external_event_at: null,
      created_at: now,
      updated_at: now,
    });

    if (input.trial_days > 0) {
      subscription.startTrial(input.trial_days, now);
    } else if (!input.is_perpetual) {
      subscription.activate({
        is_perpetual: false,
        billing_interval: input.billing_interval,
        now,
      });
    }

    return subscription;
  }

  public static reconstitute(data: SubscriptionData): Subscription {
    return new Subscription(data);
  }

  /** Cannot be called again once a subscription has ever had a trial. */
  startTrial(trial_days: number, now: Date = new Date()): void {
    if (this.#data.trial_ends_at) {
      throw new ConflictError("Subscription has already used its trial period");
    }
    if (trial_days <= 0) {
      throw new ValidationError(
        "trial_days must be greater than 0 to start a trial"
      );
    }

    const trialEndsAt = new Date(now);
    trialEndsAt.setDate(trialEndsAt.getDate() + trial_days);

    this.#data.status = "trialing";
    this.#data.trial_ends_at = trialEndsAt;
    this.#data.current_period_start = null;
    this.#data.current_period_end = null;
    this.#touch();
  }

  /**
   * The gateway-driven counterpart of `startTrial` (§2.3, §2.5): the trial
   * end is the gateway's, not computed locally. Same write-once guard —
   * a subscription that already used a trial cannot start another.
   */
  startTrialUntil(
    trial_ends_at: Date,
    input?: { external_reference?: string | null; external_event_at?: Date }
  ): void {
    if (this.#data.trial_ends_at) {
      throw new ConflictError("Subscription has already used its trial period");
    }

    this.#data.status = "trialing";
    this.#data.trial_ends_at = trial_ends_at;
    this.#data.current_period_start = null;
    this.#data.current_period_end = null;

    if (input?.external_reference !== undefined) {
      this.#data.external_reference = input.external_reference;
    }
    if (input?.external_event_at !== undefined) {
      this.#data.external_event_at = input.external_event_at;
    }
    this.#touch();
  }

  activate(input: ActivateInput): void {
    const now = input.now ?? new Date();

    if (input.is_perpetual) {
      this.#data.current_period_start = null;
      this.#data.current_period_end = null;
    } else if (input.period_end !== undefined) {
      // The gateway's period, taken literally (§2.3) — BillingCyclePolicy is
      // only consulted on the internal path, never here.
      this.#data.current_period_start = now;
      this.#data.current_period_end = input.period_end;
    } else {
      if (!input.billing_interval) {
        throw new ValidationError(
          "billing_interval is required to activate a paid plan"
        );
      }
      this.#data.current_period_start = now;
      this.#data.current_period_end = BillingCyclePolicy.nextPeriodEnd(
        now,
        input.billing_interval
      );
    }

    if (input.external_reference !== undefined) {
      this.#data.external_reference = input.external_reference;
    }
    if (input.external_event_at !== undefined) {
      this.#data.external_event_at = input.external_event_at;
    }

    this.#data.status = "active";
    this.#data.grace_period_ends_at = null;
    this.#touch();
  }

  /**
   * Accepts `active`, `trialing` and `past_due`; only `canceled` is
   * rejected (§2.4 rule 1) — a webhook reentry can find the subscription in
   * any of the first three. Reentry while already `past_due` keeps the
   * original `grace_period_ends_at`: the tolerance is anchored to the first
   * failure, not extended by every gateway retry.
   */
  markPastDue(
    grace_period_ends_at: Date,
    input?: { external_event_at?: Date }
  ): void {
    if (this.#data.status === "canceled") {
      throw new ConflictError(
        "A canceled subscription cannot be marked past due"
      );
    }

    if (this.#data.status !== "past_due") {
      this.#data.status = "past_due";
      this.#data.grace_period_ends_at = grace_period_ends_at;
    }

    if (input?.external_event_at !== undefined) {
      this.#data.external_event_at = input.external_event_at;
    }
    this.#touch();
  }

  /**
   * Idempotent (§2.4 rule 2): already canceled is a silent no-op, not a
   * `ConflictError` — a webhook reentry of `customer.subscription.deleted`
   * must resolve to 200 without publishing a second cancellation. Callers
   * that need to know whether this call actually changed anything should
   * read `status` before calling.
   */
  cancel(input: {
    is_perpetual: boolean;
    now?: Date;
    external_event_at?: Date;
  }): void {
    if (input.is_perpetual) {
      throw new ConflictError("Cannot cancel a perpetual plan subscription");
    }
    if (this.#data.status === "canceled") {
      return;
    }

    const now = input.now ?? new Date();

    // A past_due subscription already lost payment; its current_period_end
    // still points at the original paid cycle, which would let the policy
    // read cancellation as "still active" instead of reverting to Free.
    if (this.#data.status === "past_due") {
      this.#data.current_period_end = this.#data.grace_period_ends_at ?? now;
    }

    this.#data.status = "canceled";
    this.#data.canceled_at = now;
    // Never leave current_period_end null — the policy can't revert to Free without it.
    if (!this.#data.current_period_end) {
      this.#data.current_period_end = this.#data.trial_ends_at ?? now;
    }
    if (input.external_event_at !== undefined) {
      this.#data.external_event_at = input.external_event_at;
    }
    this.#touch();
  }

  /**
   * Write-once (§2.4 rule 3): pointing the subscription at a different
   * gateway customer is silently accepted only the first time. Once set,
   * changing it to a *different* reference is a `ConflictError` — routing
   * the invoice to another customer must never happen quietly. Setting the
   * same reference again is a no-op, not an error.
   */
  linkCustomer(reference: string): void {
    if (
      this.#data.external_customer_reference &&
      this.#data.external_customer_reference !== reference
    ) {
      throw new ConflictError(
        "Subscription is already linked to a different gateway customer"
      );
    }
    if (this.#data.external_customer_reference === reference) {
      return;
    }

    this.#data.external_customer_reference = reference;
    this.#touch();
  }

  /**
   * Assigns a new plan in place (DA-5) and re-derives status from its terms:
   * a trial if the subscription never had one, otherwise straight to active.
   * When `period_end` is supplied (gateway-driven, DA-9), it always goes
   * straight to `active` with that literal period — trial eligibility is
   * decided by the caller via `startTrialUntil`, not here.
   */
  changePlan(input: ChangePlanInput): void {
    const now = input.now ?? new Date();

    this.#data.plan_id = input.plan_id;
    this.#data.canceled_at = null;
    this.#data.grace_period_ends_at = null;

    if (input.period_end !== undefined) {
      this.activate({
        is_perpetual: input.is_perpetual,
        billing_interval: input.billing_interval,
        now,
        period_end: input.period_end,
        external_reference: input.external_reference,
        external_event_at: input.external_event_at,
      });
      return;
    }

    const eligibleForTrial = input.trial_days > 0 && !this.#data.trial_ends_at;

    if (eligibleForTrial) {
      this.startTrial(input.trial_days, now);
      return;
    }

    this.activate({
      is_perpetual: input.is_perpetual,
      billing_interval: input.billing_interval,
      now,
    });
  }

  #touch(): void {
    this.#data.updated_at = new Date();
    this.#data = subscriptionSchema.parse(this.#data);
  }

  get id() {
    return this.#data.id;
  }

  get user_id() {
    return this.#data.user_id;
  }

  get plan_id() {
    return this.#data.plan_id;
  }

  get status() {
    return this.#data.status;
  }

  get current_period_start() {
    return this.#data.current_period_start ?? null;
  }

  get current_period_end() {
    return this.#data.current_period_end ?? null;
  }

  get trial_ends_at() {
    return this.#data.trial_ends_at ?? null;
  }

  get canceled_at() {
    return this.#data.canceled_at ?? null;
  }

  get grace_period_ends_at() {
    return this.#data.grace_period_ends_at ?? null;
  }

  get external_reference() {
    return this.#data.external_reference ?? null;
  }

  get external_customer_reference() {
    return this.#data.external_customer_reference ?? null;
  }

  get external_event_at() {
    return this.#data.external_event_at ?? null;
  }

  /** True once the subscription entered a real billing cycle — not a trial, not a perpetual plan. */
  get has_paid_cycle() {
    return this.#data.status === "active" && !!this.#data.current_period_end;
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
