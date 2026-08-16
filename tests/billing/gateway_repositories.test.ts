import { describe, it, expect, beforeEach } from "bun:test";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { SubscriptionPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";
import { PlanPostgresRepository } from "../../src/billing/infra/database/postgres_repository/plan_postgres_repository";
import { ProcessedGatewayEventPostgresRepository } from "../../src/billing/infra/database/postgres_repository/processed_gateway_event_postgres_repository";
import { db } from "../../src/core/infra/database/drizzle/database";
import { plansTable } from "../../src/core/infra/database/drizzle/schema";
import { eq } from "drizzle-orm";

const TABLES = ["properties", "addresses", "users"];

const subscriptionRepository = new SubscriptionPostgresRepository();
const planRepository = new PlanPostgresRepository();
const processedGatewayEventRepository =
  new ProcessedGatewayEventPostgresRepository();

describe("PlanPostgresRepository.planOfExternalPriceReference", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("resolves a plan by its gateway price reference, and null when unmatched", async () => {
    const pro = await planRepository.planOfCode("pro");
    if (!pro) throw new Error("test setup: pro plan not seeded");

    await db
      .update(plansTable)
      .set({ external_price_reference: "price_pro_test" })
      .where(eq(plansTable.id, pro.id));

    try {
      const resolved =
        await planRepository.planOfExternalPriceReference("price_pro_test");
      expect(resolved?.id).toBe(pro.id);

      const unmatched = await planRepository.planOfExternalPriceReference(
        "price_does_not_exist"
      );
      expect(unmatched).toBeNull();
    } finally {
      // `plans` isn't per-test truncated (it's shared, seeded once) — undo
      // the mutation so other test files see the pro plan's original state.
      await db
        .update(plansTable)
        .set({ external_price_reference: null })
        .where(eq(plansTable.id, pro.id));
    }
  });
});

describe("SubscriptionPostgresRepository — gateway reference lookups", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("resolves by external_customer_reference and by external_reference", async () => {
    const { user } = await createUserFixture({
      name: "Conta Gateway",
      email: "gateway.lookup@sogio.dev",
      password: "password123",
    });

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("test setup: no subscription");

    subscription.linkCustomer("cus_lookup_test");
    subscription.activate({
      is_perpetual: false,
      period_end: new Date("2027-01-01T00:00:00.000Z"),
      external_reference: "sub_lookup_test",
    });
    await subscriptionRepository.save(subscription);

    const byCustomer =
      await subscriptionRepository.subscriptionOfExternalCustomerReference(
        "cus_lookup_test"
      );
    expect(byCustomer?.id).toBe(subscription.id);

    const bySubscription =
      await subscriptionRepository.subscriptionOfExternalReference(
        "sub_lookup_test"
      );
    expect(bySubscription?.id).toBe(subscription.id);

    expect(
      await subscriptionRepository.subscriptionOfExternalCustomerReference(
        "cus_does_not_exist"
      )
    ).toBeNull();
  });

  it("persists external_event_at across save/reconstitute", async () => {
    const { user } = await createUserFixture({
      name: "Conta Evento",
      email: "gateway.event-at@sogio.dev",
      password: "password123",
    });

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("test setup: no subscription");

    const eventAt = new Date("2026-06-20T00:00:00.000Z");
    subscription.activate({
      is_perpetual: false,
      period_end: new Date("2027-01-01T00:00:00.000Z"),
      external_event_at: eventAt,
    });
    await subscriptionRepository.save(subscription);

    const reloaded = await subscriptionRepository.subscriptionOfUser(user.id);
    expect(reloaded?.external_event_at).toEqual(eventAt);
  });
});

describe("SubscriptionPostgresRepository.linkCustomerReferenceIfAbsent — atomic (DA-6)", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("only the first of two concurrent calls sets its own reference; both return the same winner", async () => {
    const { user } = await createUserFixture({
      name: "Conta Concorrente",
      email: "gateway.race@sogio.dev",
      password: "password123",
    });

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("test setup: no subscription");

    const [refA, refB] = await Promise.all([
      subscriptionRepository.linkCustomerReferenceIfAbsent(
        subscription.id,
        "cus_race_a"
      ),
      subscriptionRepository.linkCustomerReferenceIfAbsent(
        subscription.id,
        "cus_race_b"
      ),
    ]);

    expect(refA).toBe(refB);
    expect(["cus_race_a", "cus_race_b"]).toContain(refA);

    const persisted = await subscriptionRepository.subscriptionOfUser(user.id);
    expect(persisted?.external_customer_reference).toBe(refA);
  });

  it("returns the already-persisted reference on a later call instead of overwriting it", async () => {
    const { user } = await createUserFixture({
      name: "Conta Ja Vinculada",
      email: "gateway.already-linked@sogio.dev",
      password: "password123",
    });

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("test setup: no subscription");

    const first = await subscriptionRepository.linkCustomerReferenceIfAbsent(
      subscription.id,
      "cus_first"
    );
    const second = await subscriptionRepository.linkCustomerReferenceIfAbsent(
      subscription.id,
      "cus_second"
    );

    expect(first).toBe("cus_first");
    expect(second).toBe("cus_first");
  });
});

describe("ProcessedGatewayEventPostgresRepository — claim/release (DA-7)", () => {
  it("claims an event once; a second claim of the same id returns false", async () => {
    const eventId = `evt_${crypto.randomUUID()}`;

    const first = await processedGatewayEventRepository.claim(
      eventId,
      "subscription_state_changed",
      new Date()
    );
    const second = await processedGatewayEventRepository.claim(
      eventId,
      "subscription_state_changed",
      new Date()
    );

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("release() lets a subsequent claim of the same id succeed again", async () => {
    const eventId = `evt_${crypto.randomUUID()}`;

    await processedGatewayEventRepository.claim(
      eventId,
      "payment_failed",
      new Date()
    );
    await processedGatewayEventRepository.release(eventId);

    const reclaimed = await processedGatewayEventRepository.claim(
      eventId,
      "payment_failed",
      new Date()
    );

    expect(reclaimed).toBe(true);
  });
});
