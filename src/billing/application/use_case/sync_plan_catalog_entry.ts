import type { UseCase } from "../../../core/application/use_case/use_case";
import type { Logger } from "../../../core/application/logger/logger";
import { ConflictError } from "../../../core/application/error/conflict_error";
import type { PlanRepository } from "../../domain/repository/plan_repository";
import { Plan, type PlanCatalogSync } from "../../domain/entity/plan";
import type { GatewayCatalogEntry } from "../gateway/gateway_catalog_entry";
import type {
  GatewayCatalogEvent,
  CatalogEntryRetiredEvent,
  CatalogProductOfferingChangedEvent,
  CatalogProductRetiredEvent,
} from "../gateway/gateway_catalog_event";

/** I-2: the free plan is a hard pre-condition of user registration and the SubscriptionAccessPolicy fallback — no catalog event may ever retire it. */
const FREE_PLAN_CODE = "free";

type Input = GatewayCatalogEvent;
type Output = void;

/**
 * The catalog's single writer (DA-3). Owns I-1 (`code` is immutable — never
 * written to an existing row), I-2 (the free plan is never retired by an
 * event), I-3 (absence never retires — enforced structurally: this class
 * only ever acts on an entry/event it was explicitly handed, never on what
 * it didn't see), DA-1 (identity is `code`; a retirement signal only
 * applies when the event's reference is the one currently linked), and the
 * "never throws" rule (DA-4) — every rejection is a logged no-op, and the
 * only exception that can escape is a genuine infrastructure failure
 * (propagated as-is so the gateway's retry is the correct behavior).
 *
 * `execute` is the webhook entrypoint (DA-3, one per catalog event type).
 * `applyReconciledEntry` is the reconciliation entrypoint (DA-5): it skips
 * the staleness check and stamps `external_event_at = now` — it reads the
 * gateway's current truth, which is by definition the freshest information
 * available, and that stamp is what makes *earlier* webhook events
 * legitimately discardable afterwards.
 */
export class SyncPlanCatalogEntryUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly planRepository: PlanRepository,
    private readonly logger: Logger
  ) {}

  async execute(event: Input): Promise<Output> {
    switch (event.type) {
      case "catalog_entry_changed":
        await this.#applyEntryChanged(
          event.entry,
          event.occurred_at,
          event.event_id,
          { ignore_staleness: false }
        );
        return;
      case "catalog_entry_retired":
        await this.#applyEntryRetired(event);
        return;
      case "catalog_product_offering_changed":
        await this.#applyProductOfferingChanged(event);
        return;
      case "catalog_product_retired":
        await this.#applyProductRetired(event);
        return;
    }
  }

  /** Reconciliation-only entrypoint (DA-5) — see class docs. */
  async applyReconciledEntry(
    entry: GatewayCatalogEntry,
    occurred_at: Date
  ): Promise<void> {
    await this.#applyEntryChanged(
      entry,
      occurred_at,
      `reconcile:${entry.external_price_reference}`,
      { ignore_staleness: true }
    );
  }

  async #applyEntryChanged(
    entry: GatewayCatalogEntry,
    occurred_at: Date,
    event_id: string,
    options: { ignore_staleness: boolean }
  ): Promise<void> {
    const existing = await this.planRepository.planOfCode(entry.code);

    if (!existing) {
      // Plan.create's factory never accepts deleted_at (WithoutBaseEntity
      // excludes it) — a brand new, already-unoffered entry is created
      // active and then retired immediately via the same idempotent method
      // the rest of this class uses.
      const plan = Plan.create({
        code: entry.code,
        name: entry.name,
        price_amount: entry.price_amount,
        billing_interval: entry.billing_interval,
        max_properties: entry.max_properties,
        trial_days: entry.trial_days,
        external_price_reference: entry.external_price_reference,
        external_product_reference: entry.external_product_reference,
        external_event_at: occurred_at,
      });
      if (!entry.is_offered && entry.code !== FREE_PLAN_CODE) {
        plan.retire(occurred_at);
      }
      await this.#save(plan, event_id);
      return;
    }

    if (
      !options.ignore_staleness &&
      this.#isStale(existing.external_event_at, occurred_at)
    ) {
      this.#logStale(event_id, existing.id);
      return;
    }

    // DA-1: a retirement signal only applies to the price reference
    // currently linked to this plan — an old, superseded price going
    // inactive must never retire the plan a newer price has since taken
    // over. A non-retirement update (including a legitimate repoint) is
    // always allowed, last-write-wins (R-11).
    const isRetirementSignal = !entry.is_offered;
    const referenceCurrentlyLinked =
      existing.external_price_reference === entry.external_price_reference;

    if (isRetirementSignal && !referenceCurrentlyLinked) {
      this.logger.warn(
        "Ignoring catalog_entry_changed retirement from a price reference this plan is no longer linked to (DA-1)",
        {
          event_id,
          plan_id: existing.id,
          plan_code: existing.code,
          event_external_price_reference: entry.external_price_reference,
          linked_external_price_reference: existing.external_price_reference,
        }
      );
      return;
    }

    const isOffered = this.#guardFreeRetirement(
      existing.code,
      entry.is_offered,
      event_id
    );

    const sync: PlanCatalogSync = {
      name: entry.name,
      price_amount: entry.price_amount,
      billing_interval: entry.billing_interval,
      max_properties: entry.max_properties,
      trial_days: entry.trial_days,
      external_price_reference: entry.external_price_reference,
      external_product_reference: entry.external_product_reference,
      is_offered: isOffered,
    };

    existing.syncFromCatalog(sync, occurred_at);
    await this.#save(existing, event_id);
  }

  async #applyEntryRetired(event: CatalogEntryRetiredEvent): Promise<void> {
    const plan = await this.planRepository.planOfExternalPriceReference(
      event.external_price_reference
    );
    if (!plan) {
      this.logger.info(
        "catalog_entry_retired for a price reference with no local plan — nothing to retire",
        {
          event_id: event.event_id,
          external_price_reference: event.external_price_reference,
        }
      );
      return;
    }

    if (this.#isStale(plan.external_event_at, event.occurred_at)) {
      this.#logStale(event.event_id, plan.id);
      return;
    }

    if (plan.code === FREE_PLAN_CODE) {
      this.#logFreeRetirementIgnored(event.event_id, plan.id);
      return;
    }

    plan.retire(event.occurred_at);
    await this.#save(plan, event.event_id);
  }

  async #applyProductOfferingChanged(
    event: CatalogProductOfferingChangedEvent
  ): Promise<void> {
    const plans = await this.planRepository.plansOfExternalProductReference(
      event.external_product_reference
    );

    for (const plan of plans) {
      if (this.#isStale(plan.external_event_at, event.occurred_at)) {
        this.#logStale(event.event_id, plan.id);
        continue;
      }

      if (plan.code === FREE_PLAN_CODE && !event.is_offered) {
        this.#logFreeRetirementIgnored(event.event_id, plan.id);
        continue;
      }

      if (event.is_offered) {
        plan.restore(event.occurred_at);
      } else {
        plan.retire(event.occurred_at);
      }
      await this.#save(plan, event.event_id);
    }
  }

  async #applyProductRetired(event: CatalogProductRetiredEvent): Promise<void> {
    const plans = await this.planRepository.plansOfExternalProductReference(
      event.external_product_reference
    );

    for (const plan of plans) {
      if (this.#isStale(plan.external_event_at, event.occurred_at)) {
        this.#logStale(event.event_id, plan.id);
        continue;
      }

      if (plan.code === FREE_PLAN_CODE) {
        this.#logFreeRetirementIgnored(event.event_id, plan.id);
        continue;
      }

      plan.retire(event.occurred_at);
      await this.#save(plan, event.event_id);
    }
  }

  /** I-2: forces `is_offered: true` for the free plan and logs when a retirement was attempted — free is logged and ignored, never thrown (DA-4). */
  #guardFreeRetirement(
    code: string,
    is_offered: boolean,
    event_id: string
  ): boolean {
    if (code !== FREE_PLAN_CODE || is_offered) return is_offered;
    this.#logFreeRetirementIgnored(event_id, code);
    return true;
  }

  #isStale(lastAppliedAt: Date | null, occurred_at: Date): boolean {
    return !!lastAppliedAt && occurred_at < lastAppliedAt;
  }

  #logStale(event_id: string, plan_id: string): void {
    this.logger.info("Discarding a stale catalog event", {
      event_id,
      plan_id,
    });
  }

  #logFreeRetirementIgnored(event_id: string, plan_id_or_code: string): void {
    this.logger.warn(
      "Ignoring an attempt to retire the free plan via catalog sync (I-2)",
      { event_id, plan: plan_id_or_code }
    );
  }

  /** R-11/DA-4: a unique-index collision on external_price_reference is a recognized outcome, logged and swallowed — never propagated. */
  async #save(plan: Plan, event_id: string): Promise<void> {
    try {
      await this.planRepository.save(plan);
    } catch (error) {
      if (error instanceof ConflictError) {
        this.logger.warn(
          "Refusing to save a catalog plan: external_price_reference collides with another plan (R-11)",
          {
            event_id,
            plan_id: plan.id,
            plan_code: plan.code,
            external_price_reference: plan.external_price_reference,
          }
        );
        return;
      }
      throw error;
    }
  }
}
