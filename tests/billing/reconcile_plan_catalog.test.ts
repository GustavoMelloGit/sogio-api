import { describe, it, expect } from "bun:test";
import { inArray } from "drizzle-orm";
import { ReconcilePlanCatalogFromGatewayUseCase } from "../../src/billing/application/use_case/reconcile_plan_catalog_from_gateway";
import { SyncPlanCatalogEntryUseCase } from "../../src/billing/application/use_case/sync_plan_catalog_entry";
import { PlanPostgresRepository } from "../../src/billing/infra/database/postgres_repository/plan_postgres_repository";
import { db } from "../../src/core/infra/database/drizzle/database";
import { plansTable } from "../../src/core/infra/database/drizzle/schema";
import type { Logger } from "../../src/core/application/logger/logger";
import type { PaymentGateway } from "../../src/billing/application/gateway/payment_gateway";
import type { GatewayCatalogEntry } from "../../src/billing/application/gateway/gateway_catalog_entry";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
};

const planRepository = new PlanPostgresRepository();
const syncPlanCatalogEntryUseCase = new SyncPlanCatalogEntryUseCase(
  planRepository,
  silentLogger
);

class StubPaymentGateway implements PaymentGateway {
  constructor(private readonly entries: GatewayCatalogEntry[]) {}

  async createCustomer(): Promise<string> {
    throw new Error("not used in this test");
  }

  async createCheckoutSession(): Promise<{ url: string }> {
    throw new Error("not used in this test");
  }

  async createBillingPortalSession(): Promise<{ url: string }> {
    throw new Error("not used in this test");
  }

  async listCatalogEntries(): Promise<GatewayCatalogEntry[]> {
    return this.entries;
  }
}

function makeUseCase(entries: GatewayCatalogEntry[]) {
  return new ReconcilePlanCatalogFromGatewayUseCase(
    new StubPaymentGateway(entries),
    syncPlanCatalogEntryUseCase,
    silentLogger
  );
}

async function deletePlans(codes: string[]): Promise<void> {
  await db.delete(plansTable).where(inArray(plansTable.code, codes));
}

describe("ReconcilePlanCatalogFromGatewayUseCase — I-3: absence never retires", () => {
  it("does not retire free or pro when the gateway's listing doesn't include their prices (the deploy-day outage scenario)", async () => {
    const freeBefore = await planRepository.planOfCode("free");
    const proBefore = await planRepository.planOfCode("pro");
    if (!freeBefore || !proBefore) {
      throw new Error("test setup: free/pro plans not seeded");
    }
    expect(freeBefore.deleted_at).toBeNull();
    expect(proBefore.deleted_at).toBeNull();

    // Simulates the exact outage this delivery fixes: production's Prices
    // exist but carry no sogio_ metadata yet, so the parser (and therefore
    // listCatalogEntries) never produces an entry for free or pro at all.
    const useCase = makeUseCase([]);
    await useCase.execute();

    const freeAfter = await planRepository.planOfCode("free");
    const proAfter = await planRepository.planOfCode("pro");

    expect(freeAfter?.deleted_at).toBeNull();
    expect(proAfter?.deleted_at).toBeNull();
    expect(freeAfter?.name).toBe(freeBefore.name);
    expect(proAfter?.name).toBe(proBefore.name);
  });

  it("does not retire a plan whose code the gateway's listing simply never mentions", async () => {
    const code = "untouched_by_reconcile_test";
    await deletePlans([code]);

    try {
      await syncPlanCatalogEntryUseCase.execute({
        type: "catalog_entry_changed",
        event_id: `evt_${crypto.randomUUID()}`,
        occurred_at: new Date(),
        entry: {
          external_price_reference: "price_untouched_test",
          external_product_reference: null,
          code,
          name: "Untouched",
          price_amount: 1500,
          billing_interval: "monthly",
          capabilities: { max_properties: 2, export_reports: false },
          trial_days: 0,
          is_offered: true,
        },
      });

      const useCase = makeUseCase([]);
      await useCase.execute();

      const reloaded = await planRepository.planOfCode(code);
      expect(reloaded?.deleted_at).toBeNull();
    } finally {
      await deletePlans([code]);
    }
  });
});

describe("ReconcilePlanCatalogFromGatewayUseCase — populates the catalog (DA-5 bootstrap)", () => {
  it("creates a plan for every entry the gateway reports", async () => {
    const code = "reconcile_bootstrap_test";
    await deletePlans([code]);

    try {
      const useCase = makeUseCase([
        {
          external_price_reference: "price_bootstrap_test",
          external_product_reference: "prod_bootstrap_test",
          code,
          name: "Bootstrap Test",
          price_amount: 4200,
          billing_interval: "monthly",
          capabilities: { max_properties: 8, export_reports: false },
          trial_days: 10,
          is_offered: true,
        },
      ]);

      const result = await useCase.execute();

      expect(result.entries_seen).toBe(1);
      const created = await planRepository.planOfCode(code);
      expect(created).not.toBeNull();
      expect(created?.price_amount).toBe(4200);
      expect(created?.capabilities.max_properties).toBe(8);
    } finally {
      await deletePlans([code]);
    }
  });
});

describe("ReconcilePlanCatalogFromGatewayUseCase — ignores staleness (DA-7)", () => {
  it("applies even when the plan's external_event_at is ahead of this reconciliation's now", async () => {
    const code = "reconcile_staleness_test";
    await deletePlans([code]);

    try {
      const future = new Date(Date.now() + 60 * 60 * 1000);
      await syncPlanCatalogEntryUseCase.execute({
        type: "catalog_entry_changed",
        event_id: `evt_${crypto.randomUUID()}`,
        occurred_at: future,
        entry: {
          external_price_reference: "price_reconcile_staleness_test",
          external_product_reference: null,
          code,
          name: "Before Reconcile",
          price_amount: 1000,
          billing_interval: "monthly",
          capabilities: { max_properties: 3, export_reports: false },
          trial_days: 0,
          is_offered: true,
        },
      });

      const useCase = makeUseCase([
        {
          external_price_reference: "price_reconcile_staleness_test",
          external_product_reference: null,
          code,
          name: "After Reconcile",
          price_amount: 1000,
          billing_interval: "monthly",
          capabilities: { max_properties: 3, export_reports: false },
          trial_days: 0,
          is_offered: true,
        },
      ]);
      await useCase.execute();

      const reloaded = await planRepository.planOfCode(code);
      expect(reloaded?.name).toBe("After Reconcile");
    } finally {
      await deletePlans([code]);
    }
  });
});
