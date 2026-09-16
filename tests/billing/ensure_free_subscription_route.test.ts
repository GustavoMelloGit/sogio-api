import { describe, it, expect, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import {
  createAdminFixture,
  createUserFixture,
} from "../helpers/fixtures/user";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { blockUser } from "../helpers/block_user";
import { PRO_PLAN_ID, FREE_PLAN_ID } from "../helpers/fixtures/plan";
import { SubscriptionPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";
import { SubscriptionHistoryPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_history_postgres_repository";
import { db } from "../../src/core/infra/database/drizzle/database";
import { subscriptionsTable } from "../../src/core/infra/database/drizzle/schema";

const TABLES = ["properties", "addresses", "users"];

const subscriptionRepository = new SubscriptionPostgresRepository();
const subscriptionHistoryRepository =
  new SubscriptionHistoryPostgresRepository();

type StatusBody = {
  has_platform_access: boolean;
  blocked_reason?: string;
  plan: { code: string } | null;
};

async function getStatus(token: string): Promise<StatusBody> {
  const res = await api("/billing/subscription", {
    method: "GET",
    headers: { Authorization: "Bearer " + token },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as StatusBody;
}

async function ensureFreeSubscription(token: string): Promise<Response> {
  return api("/billing/subscription/free-plan", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
  });
}

async function subscriptionRowOf(userId: string) {
  const row = await db.query.subscriptionsTable.findFirst({
    where: eq(subscriptionsTable.user_id, userId),
  });
  if (!row) throw new Error("test setup: no subscription row");
  return row;
}

async function removeSubscriptionOf(userId: string): Promise<void> {
  await db
    .delete(subscriptionsTable)
    .where(eq(subscriptionsTable.user_id, userId));
}

describe("POST /billing/subscription/free-plan", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("creates a Free subscription for an account with none, and unblocks it", async () => {
    const { user } = await createUserFixture({
      name: "Conta Sem Assinatura",
      email: "ensure-free.no-subscription@sogio.dev",
      password: "password123",
    });
    await removeSubscriptionOf(user.id);
    const token = await createAuthToken(user.id);

    const res = await ensureFreeSubscription(token);

    expect(res.status).toBe(204);
    const row = await subscriptionRowOf(user.id);
    expect(row.plan_id).toBe(FREE_PLAN_ID);
    expect(row.status).toBe("active");
    expect(row.current_period_end).toBeNull();

    const history = await subscriptionHistoryRepository.historyOfUser(user.id, {
      page: 1,
      limit: 20,
    });
    expect(history.pagination.total).toBe(1);
    expect(history.data[0]?.entry.type).toBe("started");

    const status = await getStatus(token);
    expect(status.has_platform_access).toBe(true);
  });

  it("is a no-op for an account already on Free", async () => {
    const { user } = await createUserFixture({
      name: "Conta Free",
      email: "ensure-free.already-free@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);
    const before = await subscriptionRowOf(user.id);

    const res = await ensureFreeSubscription(token);

    expect(res.status).toBe(204);
    const after = await subscriptionRowOf(user.id);
    expect(after.id).toBe(before.id);
    expect(after.updated_at).toEqual(before.updated_at);

    const history = await subscriptionHistoryRepository.historyOfUser(user.id, {
      page: 1,
      limit: 20,
    });
    expect(history.pagination.total).toBe(1);
  });

  it("never touches an active Pro subscription from the gateway", async () => {
    const { user } = await createUserFixture({
      name: "Conta Pro Ativa",
      email: "ensure-free.pro-active@sogio.dev",
      password: "password123",
    });
    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("test setup: no subscription");
    subscription.changePlan({
      plan_id: PRO_PLAN_ID,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      external_reference: `sub_${crypto.randomUUID()}`,
    });
    await subscriptionRepository.save(subscription);
    const before = await subscriptionRowOf(user.id);
    const token = await createAuthToken(user.id);

    const res = await ensureFreeSubscription(token);

    expect(res.status).toBe(204);
    const after = await subscriptionRowOf(user.id);
    expect(after.plan_id).toBe(PRO_PLAN_ID);
    expect(after.status).toBe("active");
    expect(after.external_reference).toBe(before.external_reference);
  });

  it("never touches a trialing Pro subscription from the gateway", async () => {
    const { user } = await createUserFixture({
      name: "Conta Pro Trial",
      email: "ensure-free.pro-trialing@sogio.dev",
      password: "password123",
    });
    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("test setup: no subscription");
    subscription.changePlan({
      plan_id: PRO_PLAN_ID,
      trial_days: 14,
      is_perpetual: false,
      billing_interval: "monthly",
      external_reference: `sub_${crypto.randomUUID()}`,
    });
    await subscriptionRepository.save(subscription);
    const before = await subscriptionRowOf(user.id);
    const token = await createAuthToken(user.id);

    const res = await ensureFreeSubscription(token);

    expect(res.status).toBe(204);
    const after = await subscriptionRowOf(user.id);
    expect(after.plan_id).toBe(PRO_PLAN_ID);
    expect(after.status).toBe("trialing");
    expect(after.external_reference).toBe(before.external_reference);
  });

  it("returns 204, not 403, for a blocked account that has a subscription", async () => {
    const { user } = await createUserFixture({
      name: "Conta Bloqueada",
      email: "ensure-free.blocked@sogio.dev",
      password: "password123",
    });
    await blockUser(user.id);
    const token = await createAuthToken(user.id);

    const res = await ensureFreeSubscription(token);

    expect(res.status).toBe(204);
    const status = await getStatus(token);
    expect(status.has_platform_access).toBe(false);
    expect(status.blocked_reason).toBe("payment_failed");
  });

  it("never touches an expired Pro subscription", async () => {
    const { user } = await createUserFixture({
      name: "Conta Pro Vencida",
      email: "ensure-free.pro-expired@sogio.dev",
      password: "password123",
    });
    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("test setup: no subscription");
    subscription.changePlan({
      plan_id: PRO_PLAN_ID,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      period_end: new Date(Date.now() - 24 * 60 * 60 * 1000),
      external_reference: `sub_${crypto.randomUUID()}`,
    });
    await subscriptionRepository.save(subscription);
    const token = await createAuthToken(user.id);

    const res = await ensureFreeSubscription(token);

    expect(res.status).toBe(204);
    const after = await subscriptionRowOf(user.id);
    expect(after.plan_id).toBe(PRO_PLAN_ID);
    expect(after.status).toBe("active");
  });

  it("never touches a canceled Pro subscription", async () => {
    const { user } = await createUserFixture({
      name: "Conta Pro Cancelada",
      email: "ensure-free.pro-canceled@sogio.dev",
      password: "password123",
    });
    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("test setup: no subscription");
    subscription.changePlan({
      plan_id: PRO_PLAN_ID,
      trial_days: 0,
      is_perpetual: false,
      billing_interval: "monthly",
      period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      external_reference: `sub_${crypto.randomUUID()}`,
    });
    subscription.cancel({ is_perpetual: false });
    await subscriptionRepository.save(subscription);
    const token = await createAuthToken(user.id);

    const res = await ensureFreeSubscription(token);

    expect(res.status).toBe(204);
    const after = await subscriptionRowOf(user.id);
    expect(after.plan_id).toBe(PRO_PLAN_ID);
    expect(after.status).toBe("canceled");
  });

  it("rejects an unauthenticated call", async () => {
    const res = await api("/billing/subscription/free-plan", {
      method: "POST",
    });

    expect(res.status).toBe(401);
  });

  it("creates the Free subscription for an admin without one", async () => {
    const { user } = await createAdminFixture({
      name: "Admin Sem Assinatura",
      email: "ensure-free.admin@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);

    const res = await ensureFreeSubscription(token);

    expect(res.status).toBe(204);
    const row = await subscriptionRowOf(user.id);
    expect(row.plan_id).toBe(FREE_PLAN_ID);
  });
});
