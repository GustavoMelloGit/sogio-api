import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { SubscriptionPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";
import { PlanPostgresRepository } from "../../src/billing/infra/database/postgres_repository/plan_postgres_repository";
import { SubscribeToPlanUseCase } from "../../src/billing/application/use_case/subscribe_to_plan";
import { CancelSubscriptionUseCase } from "../../src/billing/application/use_case/cancel_subscription";
import { inMemoryEventDispatcher } from "../../src/core/infra/event/in_memory_event_dispatcher";

const TABLES = ["properties", "addresses", "users"];

const subscriptionRepository = new SubscriptionPostgresRepository();
const planRepository = new PlanPostgresRepository();
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

type HistoryEntryResponse = {
  id: string;
  type: string;
  resulting_status: string;
  plan_id: string;
  plan_code: string;
  plan_name: string;
  occurred_at: string;
  access_until: string | null;
  reason: string | null;
};

type HistoryResponse = {
  data: HistoryEntryResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
    has_next: boolean;
    has_previous: boolean;
  };
};

/** Puts a fixture user's Free subscription into a blocked state (DA-9). */
async function blockUser(userId: string): Promise<void> {
  const subscription = await subscriptionRepository.subscriptionOfUser(userId);
  if (!subscription) {
    throw new Error("test setup: fixture user has no subscription");
  }

  const alreadyExpiredGrace = new Date(Date.now() - 60 * 60 * 1000);
  subscription.markPastDue(alreadyExpiredGrace);
  await subscriptionRepository.save(subscription);
}

describe("GET /billing/subscription/history", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("only returns the caller's own entries, never another user's (DA-3/R-5)", async () => {
    const { user: userA } = await createUserFixture({
      name: "Conta A",
      email: "route.owner-a@sogio.dev",
      password: "password123",
    });
    await subscribeToPlanUseCase.execute({ plan_code: "pro" }, userA);
    await cancelSubscriptionUseCase.execute({}, userA);
    const tokenA = await createAuthToken(userA.id);

    const { user: userB } = await createUserFixture({
      name: "Conta B",
      email: "route.owner-b@sogio.dev",
      password: "password123",
    });
    const tokenB = await createAuthToken(userB.id);

    const resA = await api("/billing/subscription/history", {
      method: "GET",
      headers: { Authorization: "Bearer " + tokenA },
    });
    expect(resA.status).toBe(200);
    const bodyA = (await resA.json()) as HistoryResponse;
    expect(bodyA.pagination.total).toBe(3);
    expect(bodyA.data.map(e => e.type)).toEqual([
      "canceled",
      "plan_changed",
      "started",
    ]);

    const resB = await api("/billing/subscription/history", {
      method: "GET",
      headers: { Authorization: "Bearer " + tokenB },
    });
    expect(resB.status).toBe(200);
    const bodyB = (await resB.json()) as HistoryResponse;
    expect(bodyB.pagination.total).toBe(1);
    expect(bodyB.data.map(e => e.type)).toEqual(["started"]);
  });

  it("paginates in descending order", async () => {
    const { user } = await createUserFixture({
      name: "Conta Paginada",
      email: "route.pagination@sogio.dev",
      password: "password123",
    });
    await subscribeToPlanUseCase.execute({ plan_code: "pro" }, user);
    await cancelSubscriptionUseCase.execute({}, user);
    const token = await createAuthToken(user.id);

    const firstPage = await api(
      "/billing/subscription/history?page=1&limit=2",
      { method: "GET", headers: { Authorization: "Bearer " + token } }
    );
    expect(firstPage.status).toBe(200);
    const firstBody = (await firstPage.json()) as HistoryResponse;
    expect(firstBody.data).toHaveLength(2);
    expect(firstBody.pagination.total).toBe(3);
    expect(firstBody.pagination.has_next).toBe(true);
    expect(firstBody.data.map(e => e.type)).toEqual([
      "canceled",
      "plan_changed",
    ]);

    const secondPage = await api(
      "/billing/subscription/history?page=2&limit=2",
      { method: "GET", headers: { Authorization: "Bearer " + token } }
    );
    const secondBody = (await secondPage.json()) as HistoryResponse;
    expect(secondBody.data).toHaveLength(1);
    expect(secondBody.pagination.has_next).toBe(false);
    expect(secondBody.data.map(e => e.type)).toEqual(["started"]);
  });

  it("returns 200, not 403, for a blocked account (DA-4 — exempt from the platform-access gate)", async () => {
    const { user } = await createUserFixture({
      name: "Conta Bloqueada",
      email: "route.blocked@sogio.dev",
      password: "password123",
    });
    await blockUser(user.id);
    const token = await createAuthToken(user.id);

    const res = await api("/billing/subscription/history", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as HistoryResponse;
    expect(body.pagination.total).toBe(1);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await api("/billing/subscription/history", {
      method: "GET",
    });

    expect(res.status).toBe(401);
  });
});
