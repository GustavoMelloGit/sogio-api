import { describe, it, expect, beforeEach } from "bun:test";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { SyncSubscriptionFromGatewayUseCase } from "../../src/billing/application/use_case/sync_subscription_from_gateway";
import { CancelSubscriptionUseCase } from "../../src/billing/application/use_case/cancel_subscription";
import { SubscriptionPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";
import { PlanPostgresRepository } from "../../src/billing/infra/database/postgres_repository/plan_postgres_repository";
import { SubscriptionHistoryPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_history_postgres_repository";
import { Plan } from "../../src/billing/domain/entity/plan";
import { inMemoryEventDispatcher } from "../../src/core/infra/event/in_memory_event_dispatcher";
import { SubscriptionPlanChangedEvent } from "../../src/billing/domain/event/subscription_plan_changed_event";
import { SubscriptionRenewedEvent } from "../../src/billing/domain/event/subscription_renewed_event";
import { SubscriptionCanceledEvent } from "../../src/billing/domain/event/subscription_canceled_event";
import type { EventHandler } from "../../src/core/application/event/event_handler";
import type { Logger } from "../../src/core/application/logger/logger";
import type { SubscriptionStateChangedEvent } from "../../src/billing/application/gateway/gateway_billing_event";
import { db } from "../../src/core/infra/database/drizzle/database";
import { plansTable } from "../../src/core/infra/database/drizzle/schema";
import { eq } from "drizzle-orm";

const TABLES = ["properties", "addresses", "users"];

const subscriptionRepository = new SubscriptionPostgresRepository();
const planRepository = new PlanPostgresRepository();
const subscriptionHistoryRepository =
  new SubscriptionHistoryPostgresRepository();

type LoggerCalls = {
  debug: unknown[][];
  info: unknown[][];
  warn: unknown[][];
  error: unknown[][];
  fatal: unknown[][];
};

function makeLogger(): Logger & { calls: LoggerCalls } {
  const calls: LoggerCalls = {
    debug: [],
    info: [],
    warn: [],
    error: [],
    fatal: [],
  };
  return {
    calls,
    debug: (...args) => calls.debug.push(args),
    info: (...args) => calls.info.push(args),
    warn: (...args) => calls.warn.push(args),
    error: (...args) => calls.error.push(args),
    fatal: (...args) => calls.fatal.push(args),
  };
}

function baseEvent(
  overrides: Partial<SubscriptionStateChangedEvent>
): SubscriptionStateChangedEvent {
  return {
    type: "subscription_state_changed",
    event_id: `evt_${crypto.randomUUID()}`,
    occurred_at: new Date(),
    external_reference: "sub_test",
    external_customer_reference: "cus_test",
    external_price_reference: null,
    status: "active",
    current_period_end: null,
    trial_end: null,
    ...overrides,
  };
}

async function setProPriceReference(): Promise<string> {
  const pro = await planRepository.planOfCode("pro");
  if (!pro) throw new Error("test setup: pro plan not seeded");
  await db
    .update(plansTable)
    .set({ external_price_reference: "price_pro_test" })
    .where(eq(plansTable.id, pro.id));
  return "price_pro_test";
}

async function clearProPriceReference(): Promise<void> {
  const pro = await planRepository.planOfCode("pro");
  if (!pro) throw new Error("test setup: pro plan not seeded");
  await db
    .update(plansTable)
    .set({ external_price_reference: null })
    .where(eq(plansTable.id, pro.id));
}

async function createTeamPlan(): Promise<{ id: string; priceRef: string }> {
  const plan = Plan.create({
    code: `team-${crypto.randomUUID().slice(0, 8)}`,
    name: "Team",
    price_amount: 9990,
    billing_interval: "monthly",
    max_properties: 20,
    trial_days: 0,
    external_price_reference: `price_team_${crypto.randomUUID().slice(0, 8)}`,
  });
  await planRepository.save(plan);
  return { id: plan.id, priceRef: plan.external_price_reference as string };
}

function makeUseCase(logger: Logger) {
  const cancelSubscriptionUseCase = new CancelSubscriptionUseCase(
    subscriptionRepository,
    planRepository,
    inMemoryEventDispatcher
  );
  return new SyncSubscriptionFromGatewayUseCase(
    subscriptionRepository,
    planRepository,
    inMemoryEventDispatcher,
    cancelSubscriptionUseCase,
    logger
  );
}

describe("SyncSubscriptionFromGatewayUseCase (DA-9)", () => {
  beforeEach(async () => {
    await truncate(TABLES);
    await clearProPriceReference();
  });

  it("logs an error and does nothing for an unresolvable subscription/customer", async () => {
    const logger = makeLogger();
    const useCase = makeUseCase(logger);

    await useCase.execute(
      baseEvent({
        external_reference: "sub_unknown",
        external_customer_reference: "cus_unknown",
      })
    );

    expect(logger.calls.error).toHaveLength(1);
  });

  it("activates on active/same-plan and dispatches renewed when the period changed", async () => {
    const priceRef = await setProPriceReference();
    const { user } = await createUserFixture({
      name: "Conta Sync Renew",
      email: "sync.renew@sogio.dev",
      password: "password123",
    });
    const pro = await planRepository.planOfCode("pro");
    if (!pro) throw new Error("no pro plan");

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("no subscription");
    subscription.linkCustomer("cus_renew");
    subscription.changePlan({
      plan_id: pro.id,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      period_end: new Date("2026-01-01T00:00:00.000Z"),
      external_reference: "sub_renew",
    });
    await subscriptionRepository.save(subscription);

    const captured: SubscriptionRenewedEvent[] = [];
    inMemoryEventDispatcher.register(SubscriptionRenewedEvent.NAME, {
      async handle(event) {
        captured.push(event as SubscriptionRenewedEvent);
      },
    } satisfies EventHandler<SubscriptionRenewedEvent>);

    const logger = makeLogger();
    const useCase = makeUseCase(logger);
    const newPeriodEnd = new Date("2026-02-01T00:00:00.000Z");

    await useCase.execute(
      baseEvent({
        external_reference: "sub_renew",
        external_customer_reference: "cus_renew",
        external_price_reference: priceRef,
        status: "active",
        current_period_end: newPeriodEnd,
        occurred_at: new Date("2026-01-15T00:00:00.000Z"),
      })
    );

    const reloaded = await subscriptionRepository.subscriptionOfUser(user.id);
    expect(reloaded?.current_period_end).toEqual(newPeriodEnd);
    expect(reloaded?.plan_id).toBe(pro.id);

    const eventsForSub = captured.filter(
      e => e.subscription_id === subscription.id
    );
    expect(eventsForSub).toHaveLength(1);
  });

  it("does not dispatch anything when nothing material changed (anti-noise, §2.6)", async () => {
    const priceRef = await setProPriceReference();
    const { user } = await createUserFixture({
      name: "Conta Sync Sem Ruido",
      email: "sync.no-noise@sogio.dev",
      password: "password123",
    });
    const pro = await planRepository.planOfCode("pro");
    if (!pro) throw new Error("no pro plan");
    const periodEnd = new Date("2026-03-01T00:00:00.000Z");

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("no subscription");
    subscription.linkCustomer("cus_noise");
    subscription.changePlan({
      plan_id: pro.id,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      period_end: periodEnd,
      external_reference: "sub_noise",
    });
    await subscriptionRepository.save(subscription);

    const captured: SubscriptionRenewedEvent[] = [];
    inMemoryEventDispatcher.register(SubscriptionRenewedEvent.NAME, {
      async handle(event) {
        captured.push(event as SubscriptionRenewedEvent);
      },
    } satisfies EventHandler<SubscriptionRenewedEvent>);

    const logger = makeLogger();
    const useCase = makeUseCase(logger);

    await useCase.execute(
      baseEvent({
        external_reference: "sub_noise",
        external_customer_reference: "cus_noise",
        external_price_reference: priceRef,
        status: "active",
        current_period_end: periodEnd,
        occurred_at: new Date("2026-01-20T00:00:00.000Z"),
      })
    );

    const eventsForSub = captured.filter(
      e => e.subscription_id === subscription.id
    );
    expect(eventsForSub).toHaveLength(0);
  });

  it("dispatches plan_changed when the price maps to a different plan", async () => {
    const { user } = await createUserFixture({
      name: "Conta Sync Troca Plano",
      email: "sync.plan-change@sogio.dev",
      password: "password123",
    });
    const pro = await planRepository.planOfCode("pro");
    if (!pro) throw new Error("no pro plan");
    const team = await createTeamPlan();

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("no subscription");
    subscription.linkCustomer("cus_switch");
    subscription.changePlan({
      plan_id: pro.id,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      period_end: new Date("2026-01-01T00:00:00.000Z"),
      external_reference: "sub_switch",
    });
    await subscriptionRepository.save(subscription);

    const capturedPlanChanged: SubscriptionPlanChangedEvent[] = [];
    inMemoryEventDispatcher.register(SubscriptionPlanChangedEvent.NAME, {
      async handle(event) {
        capturedPlanChanged.push(event as SubscriptionPlanChangedEvent);
      },
    } satisfies EventHandler<SubscriptionPlanChangedEvent>);

    const logger = makeLogger();
    const useCase = makeUseCase(logger);

    await useCase.execute(
      baseEvent({
        external_reference: "sub_switch",
        external_customer_reference: "cus_switch",
        external_price_reference: team.priceRef,
        status: "active",
        current_period_end: new Date("2026-02-01T00:00:00.000Z"),
      })
    );

    const reloaded = await subscriptionRepository.subscriptionOfUser(user.id);
    expect(reloaded?.plan_id).toBe(team.id);

    const eventsForSub = capturedPlanChanged.filter(
      e => e.subscription_id === subscription.id
    );
    expect(eventsForSub).toHaveLength(1);
  });

  it("starts a trial with the gateway's date on first-ever trialing sync", async () => {
    const priceRef = await setProPriceReference();
    const { user } = await createUserFixture({
      name: "Conta Sync Trial",
      email: "sync.trial@sogio.dev",
      password: "password123",
    });

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("no subscription");
    subscription.linkCustomer("cus_trial_sync");
    await subscriptionRepository.save(subscription);

    const logger = makeLogger();
    const useCase = makeUseCase(logger);
    const trialEnd = new Date("2026-02-15T00:00:00.000Z");

    await useCase.execute(
      baseEvent({
        external_reference: "sub_trial_sync",
        external_customer_reference: "cus_trial_sync",
        external_price_reference: priceRef,
        status: "trialing",
        trial_end: trialEnd,
      })
    );

    const reloaded = await subscriptionRepository.subscriptionOfUser(user.id);
    expect(reloaded?.status).toBe("trialing");
    expect(reloaded?.trial_ends_at).toEqual(trialEnd);
  });

  it("treats trialing as active with a log error when the subscription already used its trial (§2.5)", async () => {
    const priceRef = await setProPriceReference();
    const { user } = await createUserFixture({
      name: "Conta Sync Trial Reuso",
      email: "sync.trial-reuse@sogio.dev",
      password: "password123",
    });
    const pro = await planRepository.planOfCode("pro");
    if (!pro) throw new Error("no pro plan");

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("no subscription");
    subscription.linkCustomer("cus_trial_reuse");
    subscription.startTrialUntil(new Date("2026-01-01T00:00:00.000Z"), {
      external_reference: "sub_trial_reuse",
    });
    await subscriptionRepository.save(subscription);

    const logger = makeLogger();
    const useCase = makeUseCase(logger);
    const fakeTrialEnd = new Date("2026-03-01T00:00:00.000Z");

    await useCase.execute(
      baseEvent({
        external_reference: "sub_trial_reuse",
        external_customer_reference: "cus_trial_reuse",
        external_price_reference: priceRef,
        status: "trialing",
        trial_end: fakeTrialEnd,
      })
    );

    const reloaded = await subscriptionRepository.subscriptionOfUser(user.id);
    expect(reloaded?.status).toBe("active");
    expect(reloaded?.current_period_end).toEqual(fakeTrialEnd);
    expect(logger.calls.error.length).toBeGreaterThan(0);
  });

  it("ignores past_due and unpaid (sourced only from invoice.payment_failed)", async () => {
    const { user } = await createUserFixture({
      name: "Conta Sync PastDue Ignorado",
      email: "sync.past-due-ignored@sogio.dev",
      password: "password123",
    });
    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("no subscription");
    subscription.linkCustomer("cus_ignored");
    await subscriptionRepository.save(subscription);

    const logger = makeLogger();
    const useCase = makeUseCase(logger);

    await useCase.execute(
      baseEvent({
        external_reference: "sub_ignored",
        external_customer_reference: "cus_ignored",
        status: "past_due",
      })
    );

    const reloaded = await subscriptionRepository.subscriptionOfUser(user.id);
    expect(reloaded?.status).toBe("active");
  });

  it("delegates canceled/incomplete_expired to CancelSubscriptionUseCase", async () => {
    const priceRef = await setProPriceReference();
    const { user } = await createUserFixture({
      name: "Conta Sync Cancelada",
      email: "sync.canceled@sogio.dev",
      password: "password123",
    });
    const pro = await planRepository.planOfCode("pro");
    if (!pro) throw new Error("no pro plan");

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("no subscription");
    subscription.linkCustomer("cus_cancel_sync");
    subscription.changePlan({
      plan_id: pro.id,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      period_end: new Date("2026-02-01T00:00:00.000Z"),
      external_reference: "sub_cancel_sync",
    });
    await subscriptionRepository.save(subscription);

    const captured: SubscriptionCanceledEvent[] = [];
    inMemoryEventDispatcher.register(SubscriptionCanceledEvent.NAME, {
      async handle(event) {
        captured.push(event as SubscriptionCanceledEvent);
      },
    } satisfies EventHandler<SubscriptionCanceledEvent>);

    const logger = makeLogger();
    const useCase = makeUseCase(logger);

    await useCase.execute(
      baseEvent({
        external_reference: "sub_cancel_sync",
        external_customer_reference: "cus_cancel_sync",
        external_price_reference: priceRef,
        status: "canceled",
      })
    );

    const reloaded = await subscriptionRepository.subscriptionOfUser(user.id);
    expect(reloaded?.status).toBe("canceled");

    const eventsForSub = captured.filter(
      e => e.subscription_id === subscription.id
    );
    expect(eventsForSub).toHaveLength(1);
  });

  it("discards a stale event whose occurred_at precedes the subscription's external_event_at (DA-8)", async () => {
    const priceRef = await setProPriceReference();
    const { user } = await createUserFixture({
      name: "Conta Sync Stale",
      email: "sync.stale@sogio.dev",
      password: "password123",
    });
    const pro = await planRepository.planOfCode("pro");
    if (!pro) throw new Error("no pro plan");

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("no subscription");
    subscription.linkCustomer("cus_stale");
    subscription.changePlan({
      plan_id: pro.id,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      period_end: new Date("2026-05-01T00:00:00.000Z"),
      external_reference: "sub_stale",
      external_event_at: new Date("2026-04-15T00:00:00.000Z"),
    });
    await subscriptionRepository.save(subscription);

    const logger = makeLogger();
    const useCase = makeUseCase(logger);

    await useCase.execute(
      baseEvent({
        external_reference: "sub_stale",
        external_customer_reference: "cus_stale",
        external_price_reference: priceRef,
        status: "active",
        current_period_end: new Date("2026-06-01T00:00:00.000Z"),
        // Older than the subscription's external_event_at — must be discarded.
        occurred_at: new Date("2026-04-01T00:00:00.000Z"),
      })
    );

    const reloaded = await subscriptionRepository.subscriptionOfUser(user.id);
    expect(reloaded?.current_period_end).toEqual(
      new Date("2026-05-01T00:00:00.000Z")
    );
    expect(logger.calls.info.length).toBeGreaterThan(0);
  });

  it("does not cancel a Free subscription when incomplete_expired resolves to it via the customer fallback (security review B-3)", async () => {
    const { user } = await createUserFixture({
      name: "Conta Checkout Incompleto",
      email: "sync.incomplete-expired@sogio.dev",
      password: "password123",
    });

    // Checkout started (customer created and linked) but the Stripe
    // subscription never left `incomplete` — sync ignores that status, so
    // the local row stays Free, never linked to any gateway subscription.
    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("no subscription");
    subscription.linkCustomer("cus_incomplete_expired");
    await subscriptionRepository.save(subscription);

    expect(subscription.status).toBe("active");
    expect(subscription.external_reference).toBeNull();

    const logger = makeLogger();
    const useCase = makeUseCase(logger);

    // ~23h later Stripe reports the abandoned checkout's subscription as
    // incomplete_expired. The customer-reference fallback resolves this to
    // the Free subscription above, which must not be canceled.
    await expect(
      useCase.execute(
        baseEvent({
          external_reference: "sub_never_linked_incomplete",
          external_customer_reference: "cus_incomplete_expired",
          status: "incomplete_expired",
        })
      )
    ).resolves.toBeUndefined();

    const reloaded = await subscriptionRepository.subscriptionOfUser(user.id);
    expect(reloaded?.status).toBe("active");
    expect(reloaded?.external_reference).toBeNull();
  });

  it("does not cancel a valid Pro subscription when canceled/incomplete_expired for a different gateway subscription resolves to it via the customer fallback (security review B-5)", async () => {
    const priceRef = await setProPriceReference();
    const { user } = await createUserFixture({
      name: "Conta Resubscribe Pro",
      email: "sync.resubscribe-pro@sogio.dev",
      password: "password123",
    });
    const pro = await planRepository.planOfCode("pro");
    if (!pro) throw new Error("no pro plan");

    // First checkout attempt (sub_A) failed and was never linked locally.
    // The retry (sub_B) succeeded and is the real, paying subscription.
    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("no subscription");
    subscription.linkCustomer("cus_resubscribe_pro");
    subscription.changePlan({
      plan_id: pro.id,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      period_end: new Date("2026-09-01T00:00:00.000Z"),
      external_reference: "sub_B",
      external_event_at: new Date("2026-08-01T00:00:00.000Z"),
    });
    await subscriptionRepository.save(subscription);

    const captured: SubscriptionCanceledEvent[] = [];
    inMemoryEventDispatcher.register(SubscriptionCanceledEvent.NAME, {
      async handle(event) {
        captured.push(event as SubscriptionCanceledEvent);
      },
    } satisfies EventHandler<SubscriptionCanceledEvent>);

    const logger = makeLogger();
    const useCase = makeUseCase(logger);

    // ~23h after the successful retry, the abandoned sub_A finally expires.
    // The customer-reference fallback would resolve this to sub_B's local
    // row — the event is clocked after sub_B's watermark, so it isn't
    // discarded as stale either. It must still not cancel sub_B.
    await expect(
      useCase.execute(
        baseEvent({
          external_reference: "sub_A",
          external_customer_reference: "cus_resubscribe_pro",
          external_price_reference: priceRef,
          status: "incomplete_expired",
          occurred_at: new Date("2026-08-02T00:00:00.000Z"),
        })
      )
    ).resolves.toBeUndefined();

    const reloaded = await subscriptionRepository.subscriptionOfUser(user.id);
    expect(reloaded?.plan_id).toBe(pro.id);
    expect(reloaded?.status).toBe("active");
    expect(reloaded?.external_reference).toBe("sub_B");

    const eventsForSub = captured.filter(
      e => e.subscription_id === subscription.id
    );
    expect(eventsForSub).toHaveLength(0);

    const history = await subscriptionHistoryRepository.historyOfUser(user.id, {
      page: 1,
      limit: 20,
    });
    const canceledEntries = history.data.filter(
      row => row.entry.type === "canceled"
    );
    expect(canceledEntries).toHaveLength(0);
  });
});
