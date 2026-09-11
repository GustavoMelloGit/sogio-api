import { describe, it, expect, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import {
  createUserFixture,
  createAdminFixture,
} from "../helpers/fixtures/user";
import { createMcpAccessTokenFixture } from "../helpers/fixtures/delegated_access";
import { FREE_PLAN_ID, upgradeToPro } from "../helpers/fixtures/plan";
import { SubscriptionPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";
import { db } from "../../src/core/infra/database/drizzle/database";
import { subscriptionsTable } from "../../src/core/infra/database/drizzle/schema";
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

const UPGRADE_MESSAGE =
  "Your current plan doesn't include AI assistant access. Upgrade your plan to unlock it.";

type ToolResultErrorBody = {
  isError: boolean;
  content: Array<{ type: string; text: string }>;
};

async function callToolsList(token: string): Promise<Response> {
  return api("/mcp", {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });
}

async function callInitialize(token: string): Promise<Response> {
  return api("/mcp", {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "sogio-test-client", version: "1.0.0" },
      },
    }),
  });
}

async function downgradeToFree(userId: string): Promise<void> {
  await db
    .update(subscriptionsTable)
    .set({ plan_id: FREE_PLAN_ID })
    .where(eq(subscriptionsTable.user_id, userId));
}

async function startProTrial(userId: string, trialEndsAt: Date): Promise<void> {
  await upgradeToPro(userId);
  const subscriptionRepository = new SubscriptionPostgresRepository();
  const subscription = await subscriptionRepository.subscriptionOfUser(userId);
  if (!subscription) {
    throw new Error("test setup: fixture user has no subscription");
  }
  subscription.startTrialUntil(trialEndsAt);
  await subscriptionRepository.save(subscription);
}

async function cancelWithExpiredPeriod(userId: string): Promise<void> {
  await upgradeToPro(userId);
  const subscriptionRepository = new SubscriptionPostgresRepository();
  const subscription = await subscriptionRepository.subscriptionOfUser(userId);
  if (!subscription) {
    throw new Error("test setup: fixture user has no subscription");
  }
  const alreadyExpired = new Date(Date.now() - 60 * 60 * 1000);
  subscription.cancel({ is_perpetual: false, now: alreadyExpired });
  await subscriptionRepository.save(subscription);
}

describe("POST /mcp — ai_assistant capability gate", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("rejects a free account with 403 and the upgrade message, before reaching the transport", async () => {
    const { user } = await createUserFixture({
      name: "Conta Free",
      email: "free.mcp-ai-assistant@sogio.dev",
      password: "password123",
    });
    const { accessToken } = await createMcpAccessTokenFixture({
      userId: user.id,
      resource: MCP_RESOURCE,
    });

    const response = await callToolsList(accessToken);
    const body = (await response.json()) as ToolResultErrorBody;

    expect(response.status).toBe(403);
    expect(body.isError).toBe(true);
    expect(body.content[0]?.text).toBe(UPGRADE_MESSAGE);
  });

  it("rejects a free account with 403 on initialize, the first method any MCP client calls", async () => {
    const { user } = await createUserFixture({
      name: "Conta Free",
      email: "free.mcp-ai-assistant-initialize@sogio.dev",
      password: "password123",
    });
    const { accessToken } = await createMcpAccessTokenFixture({
      userId: user.id,
      resource: MCP_RESOURCE,
    });

    const response = await callInitialize(accessToken);
    const body = (await response.json()) as ToolResultErrorBody;

    expect(response.status).toBe(403);
    expect(body.isError).toBe(true);
    expect(body.content[0]?.text).toBe(UPGRADE_MESSAGE);
  });

  it("allows a pro account through", async () => {
    const { user } = await createUserFixture({
      name: "Conta Pro",
      email: "pro.mcp-ai-assistant@sogio.dev",
      password: "password123",
    });
    await upgradeToPro(user.id);
    const { accessToken } = await createMcpAccessTokenFixture({
      userId: user.id,
      resource: MCP_RESOURCE,
    });

    const response = await callToolsList(accessToken);

    expect(response.status).toBe(200);
  });

  it("allows an account trialing the pro plan through, with no trialing branch involved (D-3)", async () => {
    const { user } = await createUserFixture({
      name: "Conta Em Trial",
      email: "trialing.mcp-ai-assistant@sogio.dev",
      password: "password123",
    });
    const trialEndsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await startProTrial(user.id, trialEndsAt);
    const { accessToken } = await createMcpAccessTokenFixture({
      userId: user.id,
      resource: MCP_RESOURCE,
    });

    const response = await callToolsList(accessToken);

    expect(response.status).toBe(200);
  });

  it("rejects a trial-expired account with 403 through the platform-access gate, not this one (D-4)", async () => {
    const { user } = await createUserFixture({
      name: "Trial Vencido",
      email: "trial-expired.mcp-ai-assistant@sogio.dev",
      password: "password123",
    });
    const trialEndsAt = new Date(Date.now() - 60 * 60 * 1000);
    await startProTrial(user.id, trialEndsAt);
    const { accessToken } = await createMcpAccessTokenFixture({
      userId: user.id,
      resource: MCP_RESOURCE,
    });

    const response = await callToolsList(accessToken);
    const body = (await response.json()) as ToolResultErrorBody;

    expect(response.status).toBe(403);
    expect(body.content[0]?.text).toBe("trial_expired");
  });

  it("rejects a canceled account past its paid period with 403 through this gate — the case only it catches (D-4)", async () => {
    const { user } = await createUserFixture({
      name: "Assinatura Cancelada",
      email: "canceled.mcp-ai-assistant@sogio.dev",
      password: "password123",
    });
    await cancelWithExpiredPeriod(user.id);
    const { accessToken } = await createMcpAccessTokenFixture({
      userId: user.id,
      resource: MCP_RESOURCE,
    });

    const response = await callToolsList(accessToken);
    const body = (await response.json()) as ToolResultErrorBody;

    expect(response.status).toBe(403);
    expect(body.content[0]?.text).toBe(UPGRADE_MESSAGE);
  });

  it("lets an admin through even with no subscription at all (D-8)", async () => {
    const { user } = await createAdminFixture({
      name: "Admin",
      email: "admin.mcp-ai-assistant@sogio.dev",
      password: "password123",
    });
    const { accessToken } = await createMcpAccessTokenFixture({
      userId: user.id,
      resource: MCP_RESOURCE,
    });

    const response = await callToolsList(accessToken);

    expect(response.status).toBe(200);
  });

  it("still accepts a token issued before a downgrade as a credential, but rejects the call — nothing is revoked (D-7)", async () => {
    const { user } = await createUserFixture({
      name: "Conta Rebaixada",
      email: "downgraded.mcp-ai-assistant@sogio.dev",
      password: "password123",
    });
    await upgradeToPro(user.id);
    const { accessToken } = await createMcpAccessTokenFixture({
      userId: user.id,
      resource: MCP_RESOURCE,
    });
    await downgradeToFree(user.id);

    const response = await callToolsList(accessToken);
    const body = (await response.json()) as ToolResultErrorBody;

    expect(response.status).toBe(403);
    expect(body.content[0]?.text).toBe(UPGRADE_MESSAGE);
  });
});
