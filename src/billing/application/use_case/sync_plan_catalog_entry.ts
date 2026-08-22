import type { UseCase } from "../../../core/application/use_case/use_case";
import type { Logger } from "../../../core/application/logger/logger";
import { ConflictError } from "../../../core/application/error/conflict_error";
import { ValidationError } from "../../../core/application/error/validation_error";
import type { PlanRepository } from "../../domain/repository/plan_repository";
import { Plan, type PlanCatalogSync } from "../../domain/entity/plan";
import type { GatewayCatalogEntry } from "../gateway/gateway_catalog_entry";
import type {
  GatewayCatalogEvent,
  CatalogEntryRetiredEvent,
  CatalogProductOfferingChangedEvent,
  CatalogProductRetiredEvent,
} from "../gateway/gateway_catalog_event";

const FREE_PLAN_CODE = "free";

type Input = GatewayCatalogEvent;
type Output = void;

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
      const guarded = this.#guardFreePlan(
        entry.code,
        {
          is_offered: entry.is_offered,
          price_amount: entry.price_amount,
          trial_days: entry.trial_days,
        },
        event_id
      );

      const plan = Plan.create({
        code: entry.code,
        name: entry.name,
        price_amount: guarded.price_amount,
        billing_interval: entry.billing_interval,
        capabilities: entry.capabilities,
        trial_days: guarded.trial_days,
        external_price_reference: entry.external_price_reference,
        external_product_reference: entry.external_product_reference,
        external_event_at: occurred_at,
      });
      if (!guarded.is_offered) {
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

    const guarded = this.#guardFreePlan(
      existing.code,
      {
        is_offered: entry.is_offered,
        price_amount: entry.price_amount,
        trial_days: entry.trial_days,
      },
      event_id
    );

    const sync: PlanCatalogSync = {
      name: entry.name,
      price_amount: guarded.price_amount,
      billing_interval: entry.billing_interval,
      capabilities: entry.capabilities,
      trial_days: guarded.trial_days,
      external_price_reference: entry.external_price_reference,
      external_product_reference: entry.external_product_reference,
      is_offered: guarded.is_offered,
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

  #guardFreePlan(
    code: string,
    entry: { is_offered: boolean; price_amount: number; trial_days: number },
    event_id: string
  ): { is_offered: boolean; price_amount: number; trial_days: number } {
    if (code !== FREE_PLAN_CODE) return entry;

    let { is_offered, price_amount, trial_days } = entry;

    if (!is_offered) {
      this.#logFreeRetirementIgnored(event_id, code);
      is_offered = true;
    }

    if (price_amount !== 0) {
      this.logger.warn(
        "Ignoring a non-zero price_amount for the free plan — it must stay perpetual (I-2/S-3)",
        { event_id, plan: code, attempted_price_amount: price_amount }
      );
      price_amount = 0;
    }

    if (trial_days !== 0) {
      this.logger.warn(
        "Ignoring a non-zero trial_days for the free plan — it must never expire a trial (I-2/S-3)",
        { event_id, plan: code, attempted_trial_days: trial_days }
      );
      trial_days = 0;
    }

    return { is_offered, price_amount, trial_days };
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
      if (error instanceof ValidationError) {
        this.logger.warn(
          "Refusing to save a catalog plan: rejected by the database as invalid data (S-1)",
          {
            event_id,
            plan_id: plan.id,
            plan_code: plan.code,
          }
        );
        return;
      }
      throw error;
    }
  }
}
