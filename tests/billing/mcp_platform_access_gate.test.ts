import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createMcpAccessTokenFixture } from "../helpers/fixtures/delegated_access";
import { SubscriptionPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";
import { MCP_RESOURCE_PATH } from "../../src/auth/presentation/controller/delegated_access/oauth_protected_resource_metadata.controller";
import { apiBaseUrl } from "../../src/core/infra/config/environments";

const MCP_RESOURCE = `${apiBaseUrl}${MCP_RESOURCE_PATH}`;

const TABLES = [
  "issued_credentials",
  "consents",
  "app_registrations",
  "properties",
  "addresses",
  "users",
];

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

describe("POST /mcp — platform-access gate (DA-9)", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("rejects every request with 403 for a blocked account, before reaching the transport", async () => {
    const { user } = await createUserFixture({
      name: "Conta Bloqueada",
      email: "blocked.mcp@sogio.dev",
      password: "password123",
    });
    await blockUser(user.id);
    const { accessToken } = await createMcpAccessTokenFixture({
      userId: user.id,
      resource: MCP_RESOURCE,
    });

    const response = await api("/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as {
      isError: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(body.isError).toBe(true);
    expect(body.content[0]?.text).toBe("payment_failed");
  });
});
