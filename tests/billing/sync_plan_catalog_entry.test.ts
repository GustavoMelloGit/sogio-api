import { describe, it, expect } from "bun:test";
import { inArray } from "drizzle-orm";
import { SyncPlanCatalogEntryUseCase } from "../../src/billing/application/use_case/sync_plan_catalog_entry";
import { PlanPostgresRepository } from "../../src/billing/infra/database/postgres_repository/plan_postgres_repository";
import { db } from "../../src/core/infra/database/drizzle/database";
import { plansTable } from "../../src/core/infra/database/drizzle/schema";
import type { Logger } from "../../src/core/application/logger/logger";
import type { GatewayCatalogEntry } from "../../src/billing/application/gateway/gateway_catalog_entry";
import type {
  CatalogEntryChangedEvent,
  CatalogEntryRetiredEvent,
  CatalogProductOfferingChangedEvent,
  CatalogProductRetiredEvent,
} from "../../src/billing/application/gateway/gateway_catalog_event";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
};

const planRepository = new PlanPostgresRepository();
const useCase = new SyncPlanCatalogEntryUseCase(planRepository, silentLogger);

async function deletePlans(codes: string[]): Promise<void> {
  await db.delete(plansTable).where(inArray(plansTable.code, codes));
}

function makeEntry(
  overrides: Partial<GatewayCatalogEntry> = {}
): GatewayCatalogEntry {
  return {
    external_price_reference: "price_default",
    external_product_reference: "prod_default",
    code: "test_default",
    name: "Test Default",
    price_amount: 1000,
    billing_interval: "monthly",
    max_properties: 3,
    trial_days: 0,
    is_offered: true,
    ...overrides,
  };
}

function entryChangedEvent(
  entry: GatewayCatalogEntry,
  occurred_at: Date,
  event_id = `evt_${crypto.randomUUID()}`
): CatalogEntryChangedEvent {
  return { type: "catalog_entry_changed", event_id, occurred_at, entry };
}

function entryRetiredEvent(
  external_price_reference: string,
  occurred_at: Date,
  event_id = `evt_${crypto.randomUUID()}`
): CatalogEntryRetiredEvent {
  return {
    type: "catalog_entry_retired",
    event_id,
    occurred_at,
    external_price_reference,
  };
}

function productOfferingChangedEvent(
  external_product_reference: string,
  is_offered: boolean,
  occurred_at: Date,
  event_id = `evt_${crypto.randomUUID()}`
): CatalogProductOfferingChangedEvent {
  return {
    type: "catalog_product_offering_changed",
    event_id,
    occurred_at,
    external_product_reference,
    is_offered,
  };
}

function productRetiredEvent(
  external_product_reference: string,
  occurred_at: Date,
  event_id = `evt_${crypto.randomUUID()}`
): CatalogProductRetiredEvent {
  return {
    type: "catalog_product_retired",
    event_id,
    occurred_at,
    external_product_reference,
  };
}

describe("SyncPlanCatalogEntryUseCase — I-1: code is immutable", () => {
  it("a typo'd sogio_plan_code creates a new plan instead of renaming free", async () => {
    await deletePlans(["fre"]);
    const freeBefore = await planRepository.planOfCode("free");
    if (!freeBefore) throw new Error("test setup: free plan not seeded");

    try {
      await useCase.execute(
        entryChangedEvent(
          makeEntry({
            code: "fre",
            name: "Free (typo)",
            external_price_reference: "price_typo_1",
            price_amount: 0,
            max_properties: 1,
            trial_days: 0,
          }),
          new Date()
        )
      );

      const freeAfter = await planRepository.planOfCode("free");
      const typoPlan = await planRepository.planOfCode("fre");

      expect(freeAfter?.name).toBe(freeBefore.name);
      expect(freeAfter?.external_price_reference).toBe(
        freeBefore.external_price_reference
      );
      expect(typoPlan).not.toBeNull();
      expect(typoPlan?.code).toBe("fre");
    } finally {
      await deletePlans(["fre"]);
    }
  });
});

describe("SyncPlanCatalogEntryUseCase — I-2: the free plan is never retired", () => {
  it("catalog_entry_changed(is_offered:false) on free's currently-linked price is logged and ignored", async () => {
    const originalFree = await planRepository.planOfCode("free");
    if (!originalFree) throw new Error("test setup: free plan not seeded");

    try {
      // Link free to a price first (always allowed — not a retirement signal).
      await useCase.execute(
        entryChangedEvent(
          makeEntry({
            code: "free",
            name: "Free",
            external_price_reference: "price_free_i2_test",
            price_amount: 0,
            max_properties: 1,
            trial_days: 0,
            is_offered: true,
          }),
          new Date()
        )
      );

      // Now attempt to retire it via the same, currently-linked reference.
      await useCase.execute(
        entryChangedEvent(
          makeEntry({
            code: "free",
            name: "Free",
            external_price_reference: "price_free_i2_test",
            price_amount: 0,
            max_properties: 1,
            trial_days: 0,
            is_offered: false,
          }),
          new Date(Date.now() + 1000)
        )
      );

      const reloaded = await planRepository.planOfCode("free");
      expect(reloaded?.deleted_at).toBeNull();
    } finally {
      await planRepository.save(originalFree);
    }
  });

  it("catalog_entry_retired on free's linked price is logged and ignored", async () => {
    const originalFree = await planRepository.planOfCode("free");
    if (!originalFree) throw new Error("test setup: free plan not seeded");

    try {
      await useCase.execute(
        entryChangedEvent(
          makeEntry({
            code: "free",
            name: "Free",
            external_price_reference: "price_free_retired_test",
            price_amount: 0,
            max_properties: 1,
            trial_days: 0,
            is_offered: true,
          }),
          new Date()
        )
      );

      await useCase.execute(
        entryRetiredEvent(
          "price_free_retired_test",
          new Date(Date.now() + 1000)
        )
      );

      const reloaded = await planRepository.planOfCode("free");
      expect(reloaded?.deleted_at).toBeNull();
    } finally {
      await planRepository.save(originalFree);
    }
  });

  it("catalog_product_retired on free's product is logged and ignored", async () => {
    const originalFree = await planRepository.planOfCode("free");
    if (!originalFree) throw new Error("test setup: free plan not seeded");

    try {
      await useCase.execute(
        entryChangedEvent(
          makeEntry({
            code: "free",
            name: "Free",
            external_price_reference: "price_free_product_test",
            external_product_reference: "prod_free_product_test",
            price_amount: 0,
            max_properties: 1,
            trial_days: 0,
            is_offered: true,
          }),
          new Date()
        )
      );

      await useCase.execute(
        productRetiredEvent(
          "prod_free_product_test",
          new Date(Date.now() + 1000)
        )
      );

      const reloaded = await planRepository.planOfCode("free");
      expect(reloaded?.deleted_at).toBeNull();
    } finally {
      await planRepository.save(originalFree);
    }
  });
});

describe("SyncPlanCatalogEntryUseCase — DA-1: retirement only applies from the currently-linked price", () => {
  it("an old, superseded price going inactive does not retire the plan a newer price now owns", async () => {
    const code = "da1_test_plan";
    await deletePlans([code]);

    try {
      await useCase.execute(
        entryChangedEvent(
          makeEntry({
            code,
            external_price_reference: "price_da1_a",
            is_offered: true,
          }),
          new Date(Date.now() - 3000)
        )
      );
      await useCase.execute(
        entryChangedEvent(
          makeEntry({
            code,
            external_price_reference: "price_da1_b",
            is_offered: true,
          }),
          new Date(Date.now() - 2000)
        )
      );

      // The old price (A) goes inactive — must not retire the plan, which
      // is now linked to price B.
      await useCase.execute(
        entryChangedEvent(
          makeEntry({
            code,
            external_price_reference: "price_da1_a",
            is_offered: false,
          }),
          new Date(Date.now() - 1000)
        )
      );

      const stillLinkedToB = await planRepository.planOfCode(code);
      expect(stillLinkedToB?.deleted_at).toBeNull();
      expect(stillLinkedToB?.external_price_reference).toBe("price_da1_b");

      // The currently-linked price (B) going inactive DOES retire it.
      await useCase.execute(
        entryChangedEvent(
          makeEntry({
            code,
            external_price_reference: "price_da1_b",
            is_offered: false,
          }),
          new Date()
        )
      );

      const retired = await planRepository.planOfCode(code);
      expect(retired?.deleted_at).not.toBeNull();
    } finally {
      await deletePlans([code]);
    }
  });
});

describe("SyncPlanCatalogEntryUseCase — staleness (§2.4)", () => {
  it("discards an event older than the plan's external_event_at", async () => {
    const code = "stale_test_plan";
    await deletePlans([code]);

    try {
      const now = new Date();
      await useCase.execute(
        entryChangedEvent(
          makeEntry({
            code,
            name: "Fresh Name",
            external_price_reference: "price_stale_1",
          }),
          now
        )
      );

      const older = new Date(now.getTime() - 60 * 60 * 1000);
      await useCase.execute(
        entryChangedEvent(
          makeEntry({
            code,
            name: "Stale Name — must not apply",
            external_price_reference: "price_stale_1",
          }),
          older
        )
      );

      const reloaded = await planRepository.planOfCode(code);
      expect(reloaded?.name).toBe("Fresh Name");
      expect(reloaded?.external_event_at?.getTime()).toBe(now.getTime());
    } finally {
      await deletePlans([code]);
    }
  });
});

describe("SyncPlanCatalogEntryUseCase — des-aposentadoria (DA-7)", () => {
  it("clears deleted_at when the entry becomes offered again", async () => {
    const code = "restore_test_plan";
    await deletePlans([code]);

    try {
      await useCase.execute(
        entryChangedEvent(
          makeEntry({
            code,
            external_price_reference: "price_restore_1",
            is_offered: true,
          }),
          new Date(Date.now() - 2000)
        )
      );
      await useCase.execute(
        entryChangedEvent(
          makeEntry({
            code,
            external_price_reference: "price_restore_1",
            is_offered: false,
          }),
          new Date(Date.now() - 1000)
        )
      );

      const retired = await planRepository.planOfCode(code);
      expect(retired?.deleted_at).not.toBeNull();

      await useCase.execute(
        entryChangedEvent(
          makeEntry({
            code,
            external_price_reference: "price_restore_1",
            is_offered: true,
          }),
          new Date()
        )
      );

      const restored = await planRepository.planOfCode(code);
      expect(restored?.deleted_at).toBeNull();
    } finally {
      await deletePlans([code]);
    }
  });
});

describe("SyncPlanCatalogEntryUseCase — retire()/restore() idempotency", () => {
  it("keeps the original retirement instant across a repeated catalog_entry_retired", async () => {
    const code = "retire_idempotent_test";
    await deletePlans([code]);

    try {
      await useCase.execute(
        entryChangedEvent(
          makeEntry({
            code,
            external_price_reference: "price_retire_idempotent",
            is_offered: true,
          }),
          new Date(Date.now() - 2000)
        )
      );

      const firstRetireAt = new Date(Date.now() - 1000);
      await useCase.execute(
        entryRetiredEvent("price_retire_idempotent", firstRetireAt)
      );
      const afterFirst = await planRepository.planOfCode(code);
      const firstDeletedAt = afterFirst?.deleted_at?.getTime();

      const secondRetireAt = new Date();
      await useCase.execute(
        entryRetiredEvent("price_retire_idempotent", secondRetireAt)
      );
      const afterSecond = await planRepository.planOfCode(code);

      expect(afterSecond?.deleted_at?.getTime()).toBe(firstDeletedAt);
      expect(afterSecond?.external_event_at?.getTime()).toBe(
        secondRetireAt.getTime()
      );
    } finally {
      await deletePlans([code]);
    }
  });
});

describe("SyncPlanCatalogEntryUseCase — R-11: unique-index collision is a logged refusal, never a throw", () => {
  it("does not throw and leaves the colliding plan uncreated when two codes claim the same price reference", async () => {
    const codeA = "collide_a_test";
    const codeB = "collide_b_test";
    await deletePlans([codeA, codeB]);

    try {
      await useCase.execute(
        entryChangedEvent(
          makeEntry({
            code: codeA,
            external_price_reference: "price_collide_test",
            is_offered: true,
          }),
          new Date()
        )
      );

      await expect(
        useCase.execute(
          entryChangedEvent(
            makeEntry({
              code: codeB,
              external_price_reference: "price_collide_test",
              is_offered: true,
            }),
            new Date()
          )
        )
      ).resolves.toBeUndefined();

      const planA = await planRepository.planOfCode(codeA);
      const planB = await planRepository.planOfCode(codeB);

      expect(planA?.external_price_reference).toBe("price_collide_test");
      expect(planB).toBeNull();
    } finally {
      await deletePlans([codeA, codeB]);
    }
  });
});

describe("SyncPlanCatalogEntryUseCase — Product-driven events carry no business fields (§2.3)", () => {
  it("retires and restores every plan linked to a Product via catalog_product_offering_changed", async () => {
    const codeA = "group_a_test";
    const codeB = "group_b_test";
    const product = "prod_group_test";
    await deletePlans([codeA, codeB]);

    try {
      await useCase.execute(
        entryChangedEvent(
          makeEntry({
            code: codeA,
            external_price_reference: "price_group_a",
            external_product_reference: product,
            is_offered: true,
          }),
          new Date(Date.now() - 3000)
        )
      );
      await useCase.execute(
        entryChangedEvent(
          makeEntry({
            code: codeB,
            external_price_reference: "price_group_b",
            external_product_reference: product,
            is_offered: true,
          }),
          new Date(Date.now() - 2000)
        )
      );

      await useCase.execute(
        productOfferingChangedEvent(product, false, new Date(Date.now() - 1000))
      );
      const bothRetired = await Promise.all([
        planRepository.planOfCode(codeA),
        planRepository.planOfCode(codeB),
      ]);
      expect(bothRetired.every(plan => plan?.deleted_at !== null)).toBe(true);

      await useCase.execute(
        productOfferingChangedEvent(product, true, new Date())
      );
      const bothRestored = await Promise.all([
        planRepository.planOfCode(codeA),
        planRepository.planOfCode(codeB),
      ]);
      expect(bothRestored.every(plan => plan?.deleted_at === null)).toBe(true);
    } finally {
      await deletePlans([codeA, codeB]);
    }
  });

  it("retires every plan linked to a Product via catalog_product_retired", async () => {
    const codeA = "group_c_test";
    const product = "prod_group_retired_test";
    await deletePlans([codeA]);

    try {
      await useCase.execute(
        entryChangedEvent(
          makeEntry({
            code: codeA,
            external_price_reference: "price_group_c",
            external_product_reference: product,
            is_offered: true,
          }),
          new Date(Date.now() - 1000)
        )
      );

      await useCase.execute(productRetiredEvent(product, new Date()));

      const retired = await planRepository.planOfCode(codeA);
      expect(retired?.deleted_at).not.toBeNull();
    } finally {
      await deletePlans([codeA]);
    }
  });
});

describe("SyncPlanCatalogEntryUseCase — applyReconciledEntry ignores staleness", () => {
  it("applies even when occurred_at is older than the plan's current external_event_at", async () => {
    const code = "reconcile_ignore_staleness_test";
    await deletePlans([code]);

    try {
      const future = new Date(Date.now() + 60 * 60 * 1000);
      await useCase.execute(
        entryChangedEvent(
          makeEntry({
            code,
            name: "Webhook-applied name",
            external_price_reference: "price_reconcile_stale_test",
          }),
          future
        )
      );

      // A reconciliation pass reading "now" — earlier than the plan's
      // current (future, for this test) external_event_at — must still
      // apply, since reconciliation never treats itself as stale.
      await useCase.applyReconciledEntry(
        makeEntry({
          code,
          name: "Reconciled name",
          external_price_reference: "price_reconcile_stale_test",
        }),
        new Date()
      );

      const reloaded = await planRepository.planOfCode(code);
      expect(reloaded?.name).toBe("Reconciled name");
    } finally {
      await deletePlans([code]);
    }
  });
});
