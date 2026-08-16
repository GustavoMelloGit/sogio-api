import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import {
  createUserFixture,
  createAdminFixture,
} from "../helpers/fixtures/user";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { SubscriptionPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";

const TABLES = ["properties", "addresses", "users"];

/** Puts a fixture user's Free subscription into a blocked state (DA-9). */
async function blockUser(userId: string): Promise<void> {
  const subscriptionRepository = new SubscriptionPostgresRepository();
  const subscription = await subscriptionRepository.subscriptionOfUser(userId);
  if (!subscription) {
    throw new Error("test setup: fixture user has no subscription");
  }

  const alreadyExpiredGrace = new Date(Date.now() - 60 * 60 * 1000);
  subscription.markPastDue(alreadyExpiredGrace);
  await subscriptionRepository.save(subscription);
}

describe("platform-access gate (DA-9)", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("returns 403 on a gated route for a blocked account", async () => {
    const { user } = await createUserFixture({
      name: "Conta Bloqueada",
      email: "blocked.gated@sogio.dev",
      password: "password123",
    });
    await blockUser(user.id);
    const token = await createAuthToken(user.id);

    const res = await api("/property", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({
        name: "Casa Bloqueada",
        address: {
          street: "Rua X",
          number: "1",
          neighborhood: "Centro",
          city: "São Paulo",
          state: "SP",
          zip_code: "01310-100",
          country: "Brasil",
          complement: "",
        },
        images: ["https://example.com/1.jpg"],
        capacity: 2,
      }),
    });

    expect(res.status).toBe(403);
  });

  it("still allows a blocked account to read its own account (GET /auth/me)", async () => {
    const { user } = await createUserFixture({
      name: "Conta Bloqueada",
      email: "blocked.getme@sogio.dev",
      password: "password123",
    });
    await blockUser(user.id);
    const token = await createAuthToken(user.id);

    const res = await api("/auth/me", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).not.toBe(403);
  });

  it("still allows a blocked account to list connected apps (GET /auth/connected-apps)", async () => {
    const { user } = await createUserFixture({
      name: "Conta Bloqueada",
      email: "blocked.connected-apps@sogio.dev",
      password: "password123",
    });
    await blockUser(user.id);
    const token = await createAuthToken(user.id);

    const res = await api("/auth/connected-apps", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).not.toBe(403);
  });

  it("still lets a blocked account reach the disconnect-app route (never gated, even for a nonexistent consent)", async () => {
    const { user } = await createUserFixture({
      name: "Conta Bloqueada",
      email: "blocked.disconnect@sogio.dev",
      password: "password123",
    });
    await blockUser(user.id);
    const token = await createAuthToken(user.id);

    const res = await api(`/auth/connected-apps/${crypto.randomUUID()}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).not.toBe(403);
  });

  it("still lets a blocked account reach the OAuth decision route (never gated)", async () => {
    const { user } = await createUserFixture({
      name: "Conta Bloqueada",
      email: "blocked.decision@sogio.dev",
      password: "password123",
    });
    await blockUser(user.id);
    const token = await createAuthToken(user.id);

    const res = await api("/connect/authorize/decision", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({}),
    });

    expect(res.status).not.toBe(403);
  });

  it("still allows a blocked account to delete its own account (DELETE /auth/me, LGPD)", async () => {
    const { user } = await createUserFixture({
      name: "Conta Bloqueada",
      email: "blocked.purge@sogio.dev",
      password: "password123",
    });
    await blockUser(user.id);
    const token = await createAuthToken(user.id);

    const res = await api("/auth/me", {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).not.toBe(403);
  });

  it("allows an admin through a gated route even with no subscription at all", async () => {
    const { user } = await createAdminFixture({
      name: "Admin",
      email: "admin.no-subscription@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id, "admin");

    const res = await api("/settings", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).not.toBe(403);
  });
});
