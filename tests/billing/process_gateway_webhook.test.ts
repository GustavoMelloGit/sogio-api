import { describe, it, expect } from "bun:test";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { ProcessGatewayWebhookUseCase } from "../../src/billing/application/use_case/process_gateway_webhook";
import { BindGatewayCustomerUseCase } from "../../src/billing/application/use_case/bind_gateway_customer";
import { SyncSubscriptionFromGatewayUseCase } from "../../src/billing/application/use_case/sync_subscription_from_gateway";
import { CancelSubscriptionUseCase } from "../../src/billing/application/use_case/cancel_subscription";
import { MarkSubscriptionPastDueUseCase } from "../../src/billing/application/use_case/mark_subscription_past_due";
import { SyncPlanCatalogEntryUseCase } from "../../src/billing/application/use_case/sync_plan_catalog_entry";
import { SubscriptionPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";
import { PlanPostgresRepository } from "../../src/billing/infra/database/postgres_repository/plan_postgres_repository";
import { ProcessedGatewayEventPostgresRepository } from "../../src/billing/infra/database/postgres_repository/processed_gateway_event_postgres_repository";
import { SubscriptionHistoryPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_history_postgres_repository";
import { inMemoryEventDispatcher } from "../../src/core/infra/event/in_memory_event_dispatcher";
import { UnauthorizedError } from "../../src/core/application/error/unauthorized_error";
import type { Logger } from "../../src/core/application/logger/logger";
import type { GatewayWebhookVerifier } from "../../src/billing/application/gateway/gateway_webhook_verifier";
import type { GatewayBillingEvent } from "../../src/billing/application/gateway/gateway_billing_event";

const TABLES = ["properties", "addresses", "users"];

const subscriptionRepository = new SubscriptionPostgresRepository();
const planRepository = new PlanPostgresRepository();
const processedGatewayEventRepository =
  new ProcessedGatewayEventPostgresRepository();
const subscriptionHistoryRepository =
  new SubscriptionHistoryPostgresRepository();

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
};

class StubVerifier implements GatewayWebhookVerifier {
  constructor(
    private readonly result:
      | GatewayBillingEvent
      | null
      | (() => GatewayBillingEvent | null)
  ) {}

  async verify(): Promise<GatewayBillingEvent | null> {
    if (typeof this.result === "function") return this.result();
    return this.result;
  }
}

class ThrowingVerifier implements GatewayWebhookVerifier {
  async verify(): Promise<GatewayBillingEvent | null> {
    throw new UnauthorizedError("bad signature");
  }
}

function makeRealUseCase(verifier: GatewayWebhookVerifier) {
  const cancelSubscriptionUseCase = new CancelSubscriptionUseCase(
    subscriptionRepository,
    planRepository,
    inMemoryEventDispatcher
  );
  const markSubscriptionPastDueUseCase = new MarkSubscriptionPastDueUseCase(
    subscriptionRepository,
    inMemoryEventDispatcher
  );
  const bindGatewayCustomerUseCase = new BindGatewayCustomerUseCase(
    subscriptionRepository,
    silentLogger
  );
  const syncSubscriptionFromGatewayUseCase =
    new SyncSubscriptionFromGatewayUseCase(
      subscriptionRepository,
      planRepository,
      inMemoryEventDispatcher,
      cancelSubscriptionUseCase,
      silentLogger
    );
  const syncPlanCatalogEntryUseCase = new SyncPlanCatalogEntryUseCase(
    planRepository,
    silentLogger
  );

  return new ProcessGatewayWebhookUseCase(
    verifier,
    processedGatewayEventRepository,
    subscriptionRepository,
    bindGatewayCustomerUseCase,
    syncSubscriptionFromGatewayUseCase,
    cancelSubscriptionUseCase,
    markSubscriptionPastDueUseCase,
    syncPlanCatalogEntryUseCase,
    silentLogger
  );
}

describe("ProcessGatewayWebhookUseCase — trust boundary (DA-2, R-1)", () => {
  it("propagates UnauthorizedError from the verifier without touching anything else", async () => {
    const useCase = makeRealUseCase(new ThrowingVerifier());

    await expect(
      useCase.execute({ raw_payload: "{}", signature: "bad" })
    ).rejects.toMatchObject({ name: "UnauthorizedError" });
  });

  it("resolves without side effects when the verifier returns null (unhandled type)", async () => {
    const useCase = makeRealUseCase(new StubVerifier(null));

    await expect(
      useCase.execute({ raw_payload: "{}", signature: "sig" })
    ).resolves.toBeUndefined();
  });
});

describe("ProcessGatewayWebhookUseCase — idempotency (DA-7)", () => {
  it("processes an event once; a reentry with the same event_id is a no-op", async () => {
    await truncate(TABLES);
    const { user } = await createUserFixture({
      name: "Conta Webhook Idempotente",
      email: "webhook.idempotent@sogio.dev",
      password: "password123",
    });
    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("no subscription");

    const eventId = `evt_${crypto.randomUUID()}`;
    const event: GatewayBillingEvent = {
      type: "checkout_completed",
      event_id: eventId,
      occurred_at: new Date(),
      user_id: user.id,
      external_customer_reference: "cus_webhook_idempotent",
      external_reference: null,
    };

    const useCase = makeRealUseCase(new StubVerifier(event));

    await useCase.execute({ raw_payload: "{}", signature: "sig" });
    const firstLink = await subscriptionRepository.subscriptionOfUser(user.id);
    expect(firstLink?.external_customer_reference).toBe(
      "cus_webhook_idempotent"
    );

    // Reentry: same event_id, but this time it points at a different
    // customer reference — if idempotency failed, this would either throw
    // (write-once conflict) or silently overwrite. Neither should happen:
    // the claim must short-circuit before the handler ever runs again.
    const secondUseCase = makeRealUseCase(
      new StubVerifier({
        ...event,
        external_customer_reference: "cus_should_not_apply",
      })
    );
    await secondUseCase.execute({ raw_payload: "{}", signature: "sig" });

    const afterReentry = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    expect(afterReentry?.external_customer_reference).toBe(
      "cus_webhook_idempotent"
    );
  });
});

describe("ProcessGatewayWebhookUseCase — release on failure (R-6)", () => {
  it("releases the claim and rethrows when a downstream use case throws unexpectedly", async () => {
    const eventId = `evt_${crypto.randomUUID()}`;
    const event: GatewayBillingEvent = {
      type: "checkout_completed",
      event_id: eventId,
      occurred_at: new Date(),
      user_id: "b3f6c1a0-0000-4000-8000-000000000099",
      external_customer_reference: "cus_failure_path",
      external_reference: null,
    };

    const throwingBindGatewayCustomerUseCase = {
      execute: async () => {
        throw new Error("simulated transient failure");
      },
    } as unknown as BindGatewayCustomerUseCase;

    const cancelSubscriptionUseCase = new CancelSubscriptionUseCase(
      subscriptionRepository,
      planRepository,
      inMemoryEventDispatcher
    );
    const markSubscriptionPastDueUseCase = new MarkSubscriptionPastDueUseCase(
      subscriptionRepository,
      inMemoryEventDispatcher
    );
    const syncSubscriptionFromGatewayUseCase =
      new SyncSubscriptionFromGatewayUseCase(
        subscriptionRepository,
        planRepository,
        inMemoryEventDispatcher,
        cancelSubscriptionUseCase,
        silentLogger
      );
    const syncPlanCatalogEntryUseCase = new SyncPlanCatalogEntryUseCase(
      planRepository,
      silentLogger
    );

    const useCase = new ProcessGatewayWebhookUseCase(
      new StubVerifier(event),
      processedGatewayEventRepository,
      subscriptionRepository,
      throwingBindGatewayCustomerUseCase,
      syncSubscriptionFromGatewayUseCase,
      cancelSubscriptionUseCase,
      markSubscriptionPastDueUseCase,
      syncPlanCatalogEntryUseCase,
      silentLogger
    );

    await expect(
      useCase.execute({ raw_payload: "{}", signature: "sig" })
    ).rejects.toThrow("simulated transient failure");

    // The claim must have been released — a retry of the same event_id
    // should be able to claim again, not be treated as already processed.
    const reclaimed = await processedGatewayEventRepository.claim(
      eventId,
      "checkout_completed",
      event.occurred_at
    );
    expect(reclaimed).toBe(true);
  });
});

describe("ProcessGatewayWebhookUseCase — dispatch routing", () => {
  it("routes subscription_ended to CancelSubscriptionUseCase by resolved user_id", async () => {
    await truncate(TABLES);
    const { user } = await createUserFixture({
      name: "Conta Webhook Fim",
      email: "webhook.ended@sogio.dev",
      password: "password123",
    });
    const pro = await planRepository.planOfCode("pro");
    if (!pro) throw new Error("no pro plan");

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("no subscription");
    subscription.linkCustomer("cus_webhook_ended");
    subscription.changePlan({
      plan_id: pro.id,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      external_reference: "sub_webhook_ended",
    });
    await subscriptionRepository.save(subscription);

    const event: GatewayBillingEvent = {
      type: "subscription_ended",
      event_id: `evt_${crypto.randomUUID()}`,
      occurred_at: new Date(),
      external_reference: "sub_webhook_ended",
      external_customer_reference: "cus_webhook_ended",
    };

    const useCase = makeRealUseCase(new StubVerifier(event));
    await useCase.execute({ raw_payload: "{}", signature: "sig" });

    const reloaded = await subscriptionRepository.subscriptionOfUser(user.id);
    expect(reloaded?.status).toBe("canceled");
  });

  it("routes payment_failed to MarkSubscriptionPastDueUseCase by resolved user_id", async () => {
    await truncate(TABLES);
    const { user } = await createUserFixture({
      name: "Conta Webhook Falha",
      email: "webhook.payment-failed@sogio.dev",
      password: "password123",
    });
    const pro = await planRepository.planOfCode("pro");
    if (!pro) throw new Error("no pro plan");

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("no subscription");
    subscription.linkCustomer("cus_webhook_failed");
    subscription.changePlan({
      plan_id: pro.id,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      external_reference: "sub_webhook_failed",
    });
    await subscriptionRepository.save(subscription);

    const event: GatewayBillingEvent = {
      type: "payment_failed",
      event_id: `evt_${crypto.randomUUID()}`,
      occurred_at: new Date(),
      external_reference: "sub_webhook_failed",
      external_customer_reference: "cus_webhook_failed",
      reason: "card_declined",
    };

    const useCase = makeRealUseCase(new StubVerifier(event));
    await useCase.execute({ raw_payload: "{}", signature: "sig" });

    const reloaded = await subscriptionRepository.subscriptionOfUser(user.id);
    expect(reloaded?.status).toBe("past_due");
  });
});

describe("ProcessGatewayWebhookUseCase — repeated gateway retries (§2.4, items e/f)", () => {
  it("does not move grace_period_ends_at when invoice.payment_failed is delivered twice with different event_ids (item e)", async () => {
    await truncate(TABLES);
    const { user } = await createUserFixture({
      name: "Conta Webhook Falha Repetida",
      email: "webhook.payment-failed-twice@sogio.dev",
      password: "password123",
    });
    const pro = await planRepository.planOfCode("pro");
    if (!pro) throw new Error("no pro plan");

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("no subscription");
    subscription.linkCustomer("cus_webhook_failed_twice");
    subscription.changePlan({
      plan_id: pro.id,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      external_reference: "sub_webhook_failed_twice",
    });
    await subscriptionRepository.save(subscription);

    const firstEvent: GatewayBillingEvent = {
      type: "payment_failed",
      event_id: `evt_${crypto.randomUUID()}`,
      occurred_at: new Date(),
      external_reference: "sub_webhook_failed_twice",
      external_customer_reference: "cus_webhook_failed_twice",
      reason: "card_declined",
    };
    await makeRealUseCase(new StubVerifier(firstEvent)).execute({
      raw_payload: "{}",
      signature: "sig",
    });

    const afterFirst = await subscriptionRepository.subscriptionOfUser(user.id);
    const graceAfterFirst = afterFirst?.grace_period_ends_at ?? null;

    // A different event_id — a genuine second Stripe dunning retry, not a
    // reentry the claim table would dedupe.
    const secondEvent: GatewayBillingEvent = {
      ...firstEvent,
      event_id: `evt_${crypto.randomUUID()}`,
      occurred_at: new Date(Date.now() + 1000),
    };
    await makeRealUseCase(new StubVerifier(secondEvent)).execute({
      raw_payload: "{}",
      signature: "sig",
    });

    const afterSecond = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    expect(afterSecond?.grace_period_ends_at).toEqual(graceAfterFirst);
  });

  it("cancels once and both deliveries succeed when customer.subscription.deleted arrives twice with different event_ids (item f)", async () => {
    await truncate(TABLES);
    const { user } = await createUserFixture({
      name: "Conta Webhook Fim Repetido",
      email: "webhook.ended-twice@sogio.dev",
      password: "password123",
    });
    const pro = await planRepository.planOfCode("pro");
    if (!pro) throw new Error("no pro plan");

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("no subscription");
    subscription.linkCustomer("cus_webhook_ended_twice");
    subscription.changePlan({
      plan_id: pro.id,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      external_reference: "sub_webhook_ended_twice",
    });
    await subscriptionRepository.save(subscription);

    const firstEvent: GatewayBillingEvent = {
      type: "subscription_ended",
      event_id: `evt_${crypto.randomUUID()}`,
      occurred_at: new Date(),
      external_reference: "sub_webhook_ended_twice",
      external_customer_reference: "cus_webhook_ended_twice",
    };
    const secondEvent: GatewayBillingEvent = {
      ...firstEvent,
      event_id: `evt_${crypto.randomUUID()}`,
      occurred_at: new Date(Date.now() + 1000),
    };

    await expect(
      makeRealUseCase(new StubVerifier(firstEvent)).execute({
        raw_payload: "{}",
        signature: "sig",
      })
    ).resolves.toBeUndefined();
    await expect(
      makeRealUseCase(new StubVerifier(secondEvent)).execute({
        raw_payload: "{}",
        signature: "sig",
      })
    ).resolves.toBeUndefined();

    const reloaded = await subscriptionRepository.subscriptionOfUser(user.id);
    expect(reloaded?.status).toBe("canceled");

    const history = await subscriptionHistoryRepository.historyOfUser(user.id, {
      page: 1,
      limit: 20,
    });
    const canceledEntries = history.data.filter(
      row => row.entry.type === "canceled"
    );
    expect(canceledEntries).toHaveLength(1);
  });
});

describe("ProcessGatewayWebhookUseCase — idempotency writes a single history entry (item b)", () => {
  it("writes exactly one history entry for two deliveries of the same checkout_completed event_id", async () => {
    await truncate(TABLES);
    const { user } = await createUserFixture({
      name: "Conta Webhook Historico Unico",
      email: "webhook.single-history-entry@sogio.dev",
      password: "password123",
    });
    const pro = await planRepository.planOfCode("pro");
    if (!pro) throw new Error("no pro plan");

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("no subscription");
    subscription.linkCustomer("cus_single_history");
    subscription.changePlan({
      plan_id: pro.id,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      external_reference: "sub_does_not_matter",
    });
    await subscriptionRepository.save(subscription);

    const eventId = `evt_${crypto.randomUUID()}`;
    const event: GatewayBillingEvent = {
      type: "subscription_ended",
      event_id: eventId,
      occurred_at: new Date(),
      external_reference: "sub_does_not_matter",
      external_customer_reference: "cus_single_history",
    };

    await makeRealUseCase(new StubVerifier(event)).execute({
      raw_payload: "{}",
      signature: "sig",
    });
    // Same event_id both times — must be claimed only once (DA-7).
    await makeRealUseCase(new StubVerifier(event)).execute({
      raw_payload: "{}",
      signature: "sig",
    });

    const history = await subscriptionHistoryRepository.historyOfUser(user.id, {
      page: 1,
      limit: 20,
    });
    const canceledEntries = history.data.filter(
      row => row.entry.type === "canceled"
    );
    expect(canceledEntries).toHaveLength(1);
  });
});

describe("ProcessGatewayWebhookUseCase — subscription_ended reference mismatch (security review B-1)", () => {
  it("does not cancel a Free subscription when subscription_ended belongs to an abandoned checkout's gateway subscription", async () => {
    await truncate(TABLES);
    const { user } = await createUserFixture({
      name: "Conta Checkout Abandonado",
      email: "webhook.abandoned-checkout@sogio.dev",
      password: "password123",
    });

    // Checkout started (customer created and linked) but payment never
    // completed — the local subscription stays Free, never linked to any
    // gateway subscription.
    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("no subscription");
    subscription.linkCustomer("cus_abandoned_checkout");
    await subscriptionRepository.save(subscription);

    expect(subscription.status).toBe("active");
    expect(subscription.external_reference).toBeNull();

    // ~23h later Stripe reports the abandoned checkout's subscription as
    // ended. The customer-reference fallback in resolveGatewaySubscription
    // resolves this event to the Free subscription above, but that
    // subscription was never linked to this gateway subscription.
    const event: GatewayBillingEvent = {
      type: "subscription_ended",
      event_id: `evt_${crypto.randomUUID()}`,
      occurred_at: new Date(),
      external_reference: "sub_never_linked_to_local",
      external_customer_reference: "cus_abandoned_checkout",
    };

    await expect(
      makeRealUseCase(new StubVerifier(event)).execute({
        raw_payload: "{}",
        signature: "sig",
      })
    ).resolves.toBeUndefined();

    const reloaded = await subscriptionRepository.subscriptionOfUser(user.id);
    // Must still be the untouched, perpetual Free subscription — canceling
    // it would have thrown ConflictError("Cannot cancel a perpetual plan
    // subscription"), surfacing as a 409 the gateway retries forever.
    expect(reloaded?.status).toBe("active");
    expect(reloaded?.external_reference).toBeNull();
  });

  it("does not cancel a valid resubscription when a delayed subscription_ended arrives for the superseded gateway subscription", async () => {
    await truncate(TABLES);
    const { user } = await createUserFixture({
      name: "Conta Reassinatura",
      email: "webhook.resubscription@sogio.dev",
      password: "password123",
    });
    const pro = await planRepository.planOfCode("pro");
    if (!pro) throw new Error("no pro plan");

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("no subscription");
    subscription.linkCustomer("cus_resubscribed");
    // First subscription with the gateway (subscription A).
    subscription.changePlan({
      plan_id: pro.id,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      external_reference: "sub_old_a",
    });
    await subscriptionRepository.save(subscription);

    // User canceled and resubscribed: Stripe created a brand new
    // subscription (B) and a subsequent subscription_state_changed already
    // moved the local row's external_reference to it.
    subscription.changePlan({
      plan_id: pro.id,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      period_end: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      external_reference: "sub_new_b",
    });
    await subscriptionRepository.save(subscription);

    // The old subscription A's deletion event finally arrives, late,
    // referencing a gateway subscription this local row no longer points to.
    const event: GatewayBillingEvent = {
      type: "subscription_ended",
      event_id: `evt_${crypto.randomUUID()}`,
      occurred_at: new Date(),
      external_reference: "sub_old_a",
      external_customer_reference: "cus_resubscribed",
    };

    await expect(
      makeRealUseCase(new StubVerifier(event)).execute({
        raw_payload: "{}",
        signature: "sig",
      })
    ).resolves.toBeUndefined();

    const reloaded = await subscriptionRepository.subscriptionOfUser(user.id);
    // The new, valid subscription must remain active — canceling it would
    // wrongly kill a paying customer's access.
    expect(reloaded?.status).toBe("active");
    expect(reloaded?.external_reference).toBe("sub_new_b");
  });
});

describe("ProcessGatewayWebhookUseCase — payment_failed after cancellation (security review B-2)", () => {
  it("does not mark a canceled subscription past_due when a delayed payment_failed arrives after cancellation", async () => {
    await truncate(TABLES);
    const { user } = await createUserFixture({
      name: "Conta Falha Pos Cancelamento",
      email: "webhook.payment-failed-after-cancel@sogio.dev",
      password: "password123",
    });
    const pro = await planRepository.planOfCode("pro");
    if (!pro) throw new Error("no pro plan");

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("no subscription");
    subscription.linkCustomer("cus_failed_after_cancel");
    subscription.changePlan({
      plan_id: pro.id,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      external_reference: "sub_failed_after_cancel",
    });
    await subscriptionRepository.save(subscription);

    // Subscription is canceled first, as customer.subscription.deleted would.
    const endedEvent: GatewayBillingEvent = {
      type: "subscription_ended",
      event_id: `evt_${crypto.randomUUID()}`,
      occurred_at: new Date(),
      external_reference: "sub_failed_after_cancel",
      external_customer_reference: "cus_failed_after_cancel",
    };
    await makeRealUseCase(new StubVerifier(endedEvent)).execute({
      raw_payload: "{}",
      signature: "sig",
    });

    const afterCancel = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    expect(afterCancel?.status).toBe("canceled");

    // Dunning's final invoice.payment_failed shows up after cancellation —
    // delivery order across event types isn't guaranteed by the gateway.
    const paymentFailedEvent: GatewayBillingEvent = {
      type: "payment_failed",
      event_id: `evt_${crypto.randomUUID()}`,
      occurred_at: new Date(Date.now() + 1000),
      external_reference: "sub_failed_after_cancel",
      external_customer_reference: "cus_failed_after_cancel",
      reason: "card_declined",
    };

    await expect(
      makeRealUseCase(new StubVerifier(paymentFailedEvent)).execute({
        raw_payload: "{}",
        signature: "sig",
      })
    ).resolves.toBeUndefined();

    const reloaded = await subscriptionRepository.subscriptionOfUser(user.id);
    // markPastDue would have thrown ConflictError("A canceled subscription
    // cannot be marked past due") without the B-2 guard — must stay canceled.
    expect(reloaded?.status).toBe("canceled");
  });
});

describe("ProcessGatewayWebhookUseCase — payment_failed reference mismatch (security review B-4)", () => {
  it("does not mark a Free subscription past_due when payment_failed belongs to an abandoned checkout's gateway subscription", async () => {
    await truncate(TABLES);
    const { user } = await createUserFixture({
      name: "Conta Falha Checkout Abandonado",
      email: "webhook.payment-failed-abandoned@sogio.dev",
      password: "password123",
    });

    // Checkout started (customer created and linked) but payment never
    // completed — the local subscription stays Free, never linked to any
    // gateway subscription.
    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("no subscription");
    subscription.linkCustomer("cus_abandoned_checkout_failed");
    await subscriptionRepository.save(subscription);

    expect(subscription.status).toBe("active");
    expect(subscription.external_reference).toBeNull();

    // The abandoned checkout's invoice fails days later. The
    // customer-reference fallback resolves this to the Free subscription
    // above, which was never linked to this gateway subscription.
    const event: GatewayBillingEvent = {
      type: "payment_failed",
      event_id: `evt_${crypto.randomUUID()}`,
      occurred_at: new Date(),
      external_reference: "sub_never_linked_payment_failed",
      external_customer_reference: "cus_abandoned_checkout_failed",
      reason: "card_declined",
    };

    await expect(
      makeRealUseCase(new StubVerifier(event)).execute({
        raw_payload: "{}",
        signature: "sig",
      })
    ).resolves.toBeUndefined();

    const reloaded = await subscriptionRepository.subscriptionOfUser(user.id);
    // Must still be the untouched, perpetual Free subscription — marking it
    // past_due would poison a free account's history with a payment it
    // never made, eventually blocking a legitimate free account.
    expect(reloaded?.status).toBe("active");
    expect(reloaded?.external_reference).toBeNull();

    const history = await subscriptionHistoryRepository.historyOfUser(user.id, {
      page: 1,
      limit: 20,
    });
    const paymentFailedEntries = history.data.filter(
      row => row.entry.type === "payment_failed"
    );
    expect(paymentFailedEntries).toHaveLength(0);
  });
});
