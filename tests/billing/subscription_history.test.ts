import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { SubscriptionHistoryEntry } from "../../src/billing/domain/entity/subscription_history_entry";
import { SubscriptionPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";
import { PlanPostgresRepository } from "../../src/billing/infra/database/postgres_repository/plan_postgres_repository";
import { SubscriptionHistoryPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_history_postgres_repository";
import { EnsureFreeSubscriptionUseCase } from "../../src/billing/application/use_case/ensure_free_subscription";
import { SubscribeToPlanUseCase } from "../../src/billing/application/use_case/subscribe_to_plan";
import { CancelSubscriptionUseCase } from "../../src/billing/application/use_case/cancel_subscription";
import { MarkSubscriptionPastDueUseCase } from "../../src/billing/application/use_case/mark_subscription_past_due";
import { RecordSubscriptionHistoryEntryUseCase } from "../../src/billing/application/use_case/record_subscription_history_entry";
import { inMemoryEventDispatcher } from "../../src/core/infra/event/in_memory_event_dispatcher";
import { SubscriptionPlanChangedEvent } from "../../src/billing/domain/event/subscription_plan_changed_event";
import type { EventHandler } from "../../src/core/application/event/event_handler";
import type { Logger } from "../../src/core/application/logger/logger";
import type { SubscriptionHistoryRepository } from "../../src/billing/domain/repository/subscription_history_repository";

const TABLES = ["properties", "addresses", "users"];

const subscriptionRepository = new SubscriptionPostgresRepository();
const planRepository = new PlanPostgresRepository();
const subscriptionHistoryRepository =
  new SubscriptionHistoryPostgresRepository();

const subscribeToPlanUseCase = new SubscribeToPlanUseCase(
  subscriptionRepository,
  planRepository,
  inMemoryEventDispatcher
);
const cancelSubscriptionUseCase = new CancelSubscriptionUseCase(
  subscriptionRepository,
  planRepository,
  inMemoryEventDispatcher
);
const markSubscriptionPastDueUseCase = new MarkSubscriptionPastDueUseCase(
  subscriptionRepository,
  inMemoryEventDispatcher
);
const ensureFreeSubscriptionUseCase = new EnsureFreeSubscriptionUseCase(
  subscriptionRepository,
  planRepository,
  inMemoryEventDispatcher
);

/** Captures every SubscriptionPlanChangedEvent dispatched during the test run. */
const capturedPlanChangedEvents: SubscriptionPlanChangedEvent[] = [];
inMemoryEventDispatcher.register(SubscriptionPlanChangedEvent.NAME, {
  async handle(event) {
    capturedPlanChangedEvents.push(event as SubscriptionPlanChangedEvent);
  },
} satisfies EventHandler<SubscriptionPlanChangedEvent>);

describe("SubscriptionHistoryEntry — refinements (11a)", () => {
  const base = {
    subscription_id: "b3f6c1a0-0000-4000-8000-000000000001",
    user_id: "b3f6c1a0-0000-4000-8000-000000000002",
    plan_id: "b3f6c1a0-0000-4000-8000-000000000003",
    occurred_at: new Date("2026-06-15T12:00:00.000Z"),
  };

  it("rejects a reason on anything other than payment_failed", () => {
    expect(() =>
      SubscriptionHistoryEntry.record({
        ...base,
        type: "started",
        resulting_status: "active",
        access_until: null,
        reason: "card_declined",
      })
    ).toThrow();
  });

  it("requires resulting_status past_due and an access_until for payment_failed", () => {
    expect(() =>
      SubscriptionHistoryEntry.record({
        ...base,
        type: "payment_failed",
        resulting_status: "active",
        access_until: null,
        reason: "card_declined",
      })
    ).toThrow();

    expect(() =>
      SubscriptionHistoryEntry.record({
        ...base,
        type: "payment_failed",
        resulting_status: "past_due",
        access_until: null,
        reason: "card_declined",
      })
    ).toThrow();
  });

  it("requires resulting_status canceled for a canceled entry", () => {
    expect(() =>
      SubscriptionHistoryEntry.record({
        ...base,
        type: "canceled",
        resulting_status: "active",
        access_until: null,
      })
    ).toThrow();
  });

  it("requires resulting_status active or trialing for a started entry", () => {
    expect(() =>
      SubscriptionHistoryEntry.record({
        ...base,
        type: "started",
        resulting_status: "past_due",
        access_until: null,
      })
    ).toThrow();
  });

  it("accepts a well-formed entry of each type", () => {
    expect(() =>
      SubscriptionHistoryEntry.record({
        ...base,
        type: "started",
        resulting_status: "active",
        access_until: null,
      })
    ).not.toThrow();

    expect(() =>
      SubscriptionHistoryEntry.record({
        ...base,
        type: "payment_failed",
        resulting_status: "past_due",
        access_until: new Date("2026-06-22T12:00:00.000Z"),
        reason: "card_declined",
      })
    ).not.toThrow();

    expect(() =>
      SubscriptionHistoryEntry.record({
        ...base,
        type: "canceled",
        resulting_status: "canceled",
        access_until: new Date("2026-06-22T12:00:00.000Z"),
      })
    ).not.toThrow();
  });
});

describe("Subscription history — integration (11b-f, h)", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("records exactly one started entry on signup, and calling EnsureFreeSubscription again doesn't duplicate it (11b)", async () => {
    const { user } = await createUserFixture({
      name: "Conta Nova",
      email: "history.started@sogio.dev",
      password: "password123",
    });

    const afterSignup = await subscriptionHistoryRepository.historyOfUser(
      user.id,
      { page: 1, limit: 20 }
    );
    expect(afterSignup.pagination.total).toBe(1);
    expect(afterSignup.data[0]?.entry.type).toBe("started");

    await ensureFreeSubscriptionUseCase.execute({ user_id: user.id });

    const afterSecondCall = await subscriptionHistoryRepository.historyOfUser(
      user.id,
      { page: 1, limit: 20 }
    );
    expect(afterSecondCall.pagination.total).toBe(1);
  });

  it("records a plan_changed entry with resulting_status trialing and access_until = trial_ends_at on free -> pro with a trial (11c)", async () => {
    const { user } = await createUserFixture({
      name: "Conta Trial",
      email: "history.trial@sogio.dev",
      password: "password123",
    });

    await subscribeToPlanUseCase.execute({ plan_code: "pro" }, user);

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    expect(subscription?.status).toBe("trialing");

    const history = await subscriptionHistoryRepository.historyOfUser(user.id, {
      page: 1,
      limit: 20,
    });
    const latest = history.data[0]?.entry;
    expect(latest?.type).toBe("plan_changed");
    expect(latest?.resulting_status).toBe("trialing");
    expect(latest?.access_until).toEqual(subscription?.trial_ends_at ?? null);
  });

  it("carries opens_paid_cycle: false on a pro -> free downgrade and true on a subsequent free -> pro switch without a trial (11d)", async () => {
    const { user } = await createUserFixture({
      name: "Conta Upgrade Downgrade",
      email: "history.opens-paid-cycle@sogio.dev",
      password: "password123",
    });

    // Uses the trial: free -> pro lands on `trialing`.
    await subscribeToPlanUseCase.execute({ plan_code: "pro" }, user);
    // Downgrade: pro -> free.
    await subscribeToPlanUseCase.execute({ plan_code: "free" }, user);
    // The trial was already used, so this lands straight on `active` with a real period.
    await subscribeToPlanUseCase.execute({ plan_code: "pro" }, user);

    const eventsForUser = capturedPlanChangedEvents.filter(
      event => event.user_id === user.id
    );
    expect(eventsForUser).toHaveLength(3);
    expect(eventsForUser[1]?.opens_paid_cycle).toBe(false);
    expect(eventsForUser[2]?.opens_paid_cycle).toBe(true);
  });

  it("records a canceled entry with access_until = current_period_end (11e)", async () => {
    const { user } = await createUserFixture({
      name: "Conta Cancelamento",
      email: "history.canceled@sogio.dev",
      password: "password123",
    });

    await subscribeToPlanUseCase.execute({ plan_code: "pro" }, user);
    await cancelSubscriptionUseCase.execute({}, user);

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    expect(subscription?.status).toBe("canceled");

    const history = await subscriptionHistoryRepository.historyOfUser(user.id, {
      page: 1,
      limit: 20,
    });
    const latest = history.data[0]?.entry;
    expect(latest?.type).toBe("canceled");
    expect(latest?.resulting_status).toBe("canceled");
    expect(latest?.access_until).toEqual(subscription?.current_period_end);
  });

  it("records a payment_failed entry with reason and access_until (11f)", async () => {
    const { user } = await createUserFixture({
      name: "Conta Inadimplente",
      email: "history.past-due@sogio.dev",
      password: "password123",
    });

    await markSubscriptionPastDueUseCase.execute({
      user_id: user.id,
      reason: "card_declined",
    });

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    expect(subscription?.status).toBe("past_due");

    const history = await subscriptionHistoryRepository.historyOfUser(user.id, {
      page: 1,
      limit: 20,
    });
    const latest = history.data[0]?.entry;
    expect(latest?.type).toBe("payment_failed");
    expect(latest?.resulting_status).toBe("past_due");
    expect(latest?.reason).toBe("card_declined");
    expect(latest?.access_until).toEqual(subscription?.grace_period_ends_at);
  });

  it("purges history rows along with the account, without breaking account deletion (11h / R-1)", async () => {
    const { user } = await createUserFixture({
      name: "Conta Exclusao",
      email: "history.purge@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);

    const before = await subscriptionHistoryRepository.historyOfUser(user.id, {
      page: 1,
      limit: 20,
    });
    expect(before.pagination.total).toBe(1);

    const res = await api("/auth/me", {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    expect(res.status).toBe(204);

    const after = await subscriptionHistoryRepository.historyOfUser(user.id, {
      page: 1,
      limit: 20,
    });
    expect(after.pagination.total).toBe(0);
  });
});

describe("RecordSubscriptionHistoryEntryUseCase — failure handling (11i)", () => {
  it("catches and logs an append() failure instead of propagating it", async () => {
    const errors: Record<string, unknown>[] = [];
    const stubLogger: Logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (_message, context) => {
        errors.push(context ?? {});
      },
      fatal: () => {},
    };

    const failingRepository: SubscriptionHistoryRepository = {
      append: () => {
        throw new Error("db is down");
      },
      historyOfUser: () => {
        throw new Error("not used in this test");
      },
    };

    const useCase = new RecordSubscriptionHistoryEntryUseCase(
      stubLogger,
      failingRepository
    );

    await expect(
      useCase.execute({
        subscription_id: "b3f6c1a0-0000-4000-8000-000000000001",
        user_id: "b3f6c1a0-0000-4000-8000-000000000002",
        plan_id: "b3f6c1a0-0000-4000-8000-000000000003",
        type: "started",
        resulting_status: "active",
        occurred_at: new Date(),
        access_until: null,
      })
    ).resolves.toBeUndefined();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.subscription_id).toBe(
      "b3f6c1a0-0000-4000-8000-000000000001"
    );
  });
});
