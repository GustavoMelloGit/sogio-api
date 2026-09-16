import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { SubscriptionPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";

const TABLES = ["properties", "addresses", "users"];

type StatusBody = {
  has_platform_access: boolean;
  status: string;
  plan: { id: string; code: string; name: string } | null;
  blocked_reason?: string;
};

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

describe("GET /billing/subscription", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("returns 200 with the entitlement for an account with normal access", async () => {
    const { user } = await createUserFixture({
      name: "Conta Normal",
      email: "normal.status@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);

    const res = await api("/billing/subscription", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as StatusBody;
    expect(body.has_platform_access).toBe(true);
    expect(body.blocked_reason).toBeUndefined();
    expect(body.plan).toMatchObject({ code: "free", name: "Free" });
    expect(body.plan?.id).toEqual(expect.any(String));
  });

  /**
   * The whole point of this route (DA-9 remediation path): a blocked account
   * has no other way to learn why it's blocked, since every other gated
   * route 403s.
   */
  it("returns 200, not 403, with the block reason for a blocked account", async () => {
    const { user } = await createUserFixture({
      name: "Conta Bloqueada",
      email: "blocked.status@sogio.dev",
      password: "password123",
    });
    await blockUser(user.id);
    const token = await createAuthToken(user.id);

    const res = await api("/billing/subscription", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as StatusBody;
    expect(body.has_platform_access).toBe(false);
    expect(body.status).toBe("past_due");
    expect(body.blocked_reason).toBe("payment_failed");
    expect(body.plan?.code).toBe("free");
  });
});
