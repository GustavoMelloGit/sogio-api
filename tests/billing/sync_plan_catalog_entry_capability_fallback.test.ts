import { describe, it, expect } from "bun:test";
import { SyncPlanCatalogEntryUseCase } from "../../src/billing/application/use_case/sync_plan_catalog_entry";
import type { PlanRepository } from "../../src/billing/domain/repository/plan_repository";
import type { Plan } from "../../src/billing/domain/entity/plan";
import type { Logger } from "../../src/core/application/logger/logger";
import type { GatewayCatalogEntry } from "../../src/billing/application/gateway/gateway_catalog_entry";
import type { CatalogEntryChangedEvent } from "../../src/billing/application/gateway/gateway_catalog_event";
import type { CapabilityKey } from "../../src/billing/domain/capability/capability_key";

class InMemoryPlanRepository implements PlanRepository {
  #plans = new Map<string, Plan>();

  async planOfId(id: string): Promise<Plan | null> {
    return this.#plans.get(id) ?? null;
  }

  async planOfCode(code: string): Promise<Plan | null> {
    for (const plan of this.#plans.values()) {
      if (plan.code === code) return plan;
    }
    return null;
  }

  async planOfExternalPriceReference(reference: string): Promise<Plan | null> {
    for (const plan of this.#plans.values()) {
      if (plan.external_price_reference === reference) return plan;
    }
    return null;
  }

  async plansOfExternalProductReference(reference: string): Promise<Plan[]> {
    return [...this.#plans.values()].filter(
      plan => plan.external_product_reference === reference
    );
  }

  async allOffered(): Promise<Plan[]> {
    return [...this.#plans.values()].filter(plan => plan.deleted_at === null);
  }

  async save(plan: Plan): Promise<void> {
    this.#plans.set(plan.id, plan);
  }
}

function makeSpyLogger(): {
  logger: Logger;
  warnCalls: Array<[string, Record<string, unknown> | undefined]>;
} {
  const warnCalls: Array<[string, Record<string, unknown> | undefined]> = [];
  return {
    logger: {
      debug: () => {},
      info: () => {},
      warn: (message, context) => {
        warnCalls.push([message, context]);
      },
      error: () => {},
      fatal: () => {},
    },
    warnCalls,
  };
}

function makeEntry(
  overrides: Partial<GatewayCatalogEntry> = {}
): GatewayCatalogEntry {
  return {
    external_price_reference: "price_fallback_test",
    external_product_reference: "prod_fallback_test",
    code: "fallback_test_plan",
    name: "Fallback Test",
    price_amount: 1000,
    billing_interval: "monthly",
    capabilities: {
      max_properties: 3,
      export_reports: false,
      bulk_import: false,
    },
    trial_days: 0,
    is_offered: true,
    ...overrides,
  };
}

function entryChangedEvent(
  entry: GatewayCatalogEntry,
  occurred_at: Date = new Date()
): CatalogEntryChangedEvent {
  return {
    type: "catalog_entry_changed",
    event_id: `evt_${crypto.randomUUID()}`,
    occurred_at,
    entry,
  };
}

describe("SyncPlanCatalogEntryUseCase — capability fallback warns on the write path (C-5)", () => {
  it("warns with reason 'absent' when the entry's capabilities record is missing a registry key", async () => {
    const repository = new InMemoryPlanRepository();
    const { logger, warnCalls } = makeSpyLogger();
    const useCase = new SyncPlanCatalogEntryUseCase(repository, logger);

    const degradedCapabilities = {
      max_properties: 3,
    } as Record<CapabilityKey, boolean | number>;

    await useCase.execute(
      entryChangedEvent(makeEntry({ capabilities: degradedCapabilities }))
    );

    const call = warnCalls.find(([message]) =>
      message.includes("fell back to registry defaults on write")
    );
    expect(call?.[1]?.fallbacks).toEqual([
      { key: "export_reports", reason: "absent" },
      { key: "bulk_import", reason: "absent" },
    ]);
  });

  it("warns with reason 'wrong_type' when a capability value has the wrong type", async () => {
    const repository = new InMemoryPlanRepository();
    const { logger, warnCalls } = makeSpyLogger();
    const useCase = new SyncPlanCatalogEntryUseCase(repository, logger);

    const degradedCapabilities = {
      max_properties: 3,
      export_reports: "yes",
    } as unknown as Record<CapabilityKey, boolean | number>;

    await useCase.execute(
      entryChangedEvent(makeEntry({ capabilities: degradedCapabilities }))
    );

    const call = warnCalls.find(([message]) =>
      message.includes("fell back to registry defaults on write")
    );
    expect(call?.[1]?.fallbacks).toEqual([
      { key: "export_reports", reason: "wrong_type" },
      { key: "bulk_import", reason: "absent" },
    ]);
  });

  it("does not warn when every capability is present with the correct type", async () => {
    const repository = new InMemoryPlanRepository();
    const { logger, warnCalls } = makeSpyLogger();
    const useCase = new SyncPlanCatalogEntryUseCase(repository, logger);

    await useCase.execute(entryChangedEvent(makeEntry()));

    expect(
      warnCalls.some(([message]) =>
        message.includes("fell back to registry defaults on write")
      )
    ).toBe(false);
  });
});
