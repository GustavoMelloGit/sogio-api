import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, it, expect, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import {
  createAdminFixture,
  createUserFixture,
} from "../helpers/fixtures/user";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { PRO_PLAN_ID, FREE_PLAN_ID } from "../helpers/fixtures/plan";
import { ConfirmFreePlanChoiceUseCase } from "../../src/billing/application/use_case/confirm_free_plan_choice";
import { SubscriptionPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";
import { BillingDi } from "../../src/billing/infra/di/billing_di";
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { db } from "../../src/core/infra/database/drizzle/database";
import { subscriptionsTable } from "../../src/core/infra/database/drizzle/schema";

const TABLES = ["properties", "addresses", "users"];

const subscriptionRepository = new SubscriptionPostgresRepository();

type StatusBody = {
  plan: { code: string } | null;
  needs_plan_choice: boolean;
};

async function getStatus(token: string): Promise<StatusBody> {
  const res = await api("/billing/subscription", {
    method: "GET",
    headers: { Authorization: "Bearer " + token },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as StatusBody;
}

async function confirmFreePlan(token: string): Promise<Response> {
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

async function putOnGatewayPro(userId: string): Promise<Date> {
  const subscription = await subscriptionRepository.subscriptionOfUser(userId);
  if (!subscription) throw new Error("test setup: no subscription");
  const chosenAt = new Date("2026-01-10T10:00:00.000Z");

  subscription.changePlan({
    plan_id: PRO_PLAN_ID,
    trial_days: 14,
    is_perpetual: false,
    billing_interval: "monthly",
    period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    external_reference: `sub_${crypto.randomUUID()}`,
  });
  subscription.recordPlanChoice(chosenAt);
  await subscriptionRepository.save(subscription);

  return chosenAt;
}

describe("POST /billing/subscription/free-plan", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("reports a new account as needing the initial plan choice", async () => {
    const { user } = await createUserFixture({
      name: "Conta Nova",
      email: "plan-choice.new@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);

    const body = await getStatus(token);

    expect(body.needs_plan_choice).toBe(true);
    expect(body.plan?.code).toBe("free");
  });

  it("records the choice with 204 and keeps the account on Free", async () => {
    const { user } = await createUserFixture({
      name: "Conta Escolhe Free",
      email: "plan-choice.free@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);

    const res = await confirmFreePlan(token);

    expect(res.status).toBe(204);
    const body = await getStatus(token);
    expect(body.needs_plan_choice).toBe(false);
    expect(body.plan?.code).toBe("free");

    const row = await subscriptionRowOf(user.id);
    expect(row.plan_id).toBe(FREE_PLAN_ID);
    expect(row.plan_chosen_at).toBeInstanceOf(Date);
  });

  it("is a silent no-op on a second call, keeping the first recorded instant", async () => {
    const { user } = await createUserFixture({
      name: "Conta Repete Free",
      email: "plan-choice.repeat@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);

    expect((await confirmFreePlan(token)).status).toBe(204);
    const first = await subscriptionRowOf(user.id);

    expect((await confirmFreePlan(token)).status).toBe(204);
    const second = await subscriptionRowOf(user.id);

    expect(second.plan_chosen_at).toEqual(first.plan_chosen_at);
    expect(second.updated_at).toEqual(first.updated_at);
  });

  it("never changes a gateway Pro subscription whose choice is already recorded", async () => {
    const { user } = await createUserFixture({
      name: "Conta Pro",
      email: "plan-choice.pro@sogio.dev",
      password: "password123",
    });
    const chosenAt = await putOnGatewayPro(user.id);
    const before = await subscriptionRowOf(user.id);
    const token = await createAuthToken(user.id);

    const res = await confirmFreePlan(token);

    expect(res.status).toBe(204);
    const after = await subscriptionRowOf(user.id);
    expect(after).toEqual(before);
    expect(after.plan_id).toBe(PRO_PLAN_ID);
    expect(after.plan_chosen_at).toEqual(chosenAt);
    expect((await getStatus(token)).plan?.code).toBe("pro");
  });

  it("rejects an unauthenticated call", async () => {
    const res = await api("/billing/subscription/free-plan", {
      method: "POST",
    });

    expect(res.status).toBe(401);
  });

  it("stops an account without a subscription at the platform-access gate", async () => {
    const { user } = await createUserFixture({
      name: "Conta Sem Assinatura",
      email: "plan-choice.no-subscription@sogio.dev",
      password: "password123",
    });
    await removeSubscriptionOf(user.id);
    const token = await createAuthToken(user.id);

    const res = await confirmFreePlan(token);

    expect(res.status).toBe(403);
  });

  it("returns 404 for an admin without a subscription, who passes the gate", async () => {
    const { user } = await createAdminFixture({
      name: "Admin Sem Assinatura",
      email: "plan-choice.admin@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);

    const res = await confirmFreePlan(token);

    expect(res.status).toBe(404);
  });

  it("reports no pending choice for an account without a subscription", async () => {
    const { user } = await createUserFixture({
      name: "Conta Sem Assinatura Status",
      email: "plan-choice.no-subscription.status@sogio.dev",
      password: "password123",
    });
    await removeSubscriptionOf(user.id);
    const token = await createAuthToken(user.id);

    const body = await getStatus(token);

    expect(body.needs_plan_choice).toBe(false);
    expect(body.plan).toBeNull();
  });
});

describe("ConfirmFreePlanChoiceUseCase", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("throws ResourceNotFoundError when the user has no subscription", async () => {
    const { user } = await createUserFixture({
      name: "Conta Caso De Uso Sem Assinatura",
      email: "plan-choice.use-case.404@sogio.dev",
      password: "password123",
    });
    await removeSubscriptionOf(user.id);
    const useCase = new ConfirmFreePlanChoiceUseCase(subscriptionRepository);

    await expect(useCase.execute({}, user)).rejects.toMatchObject({
      name: "ResourceNotFoundError",
    });
  });
});

describe("SubscriptionPostgresRepository.recordPlanChoiceIfAbsent", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("writes only the choice, so a stale read never undoes a concurrent plan change", async () => {
    const { user } = await createUserFixture({
      name: "Conta Corrida",
      email: "plan-choice.race@sogio.dev",
      password: "password123",
    });
    const staleRead = await subscriptionRepository.subscriptionOfUser(user.id);
    if (!staleRead) throw new Error("test setup: no subscription");

    const concurrent = await subscriptionRepository.subscriptionOfUser(user.id);
    if (!concurrent) throw new Error("test setup: no subscription");
    concurrent.startTrialUntil(new Date(Date.now() + 14 * 86_400_000), {
      external_reference: "sub_concurrent_trial",
    });
    await subscriptionRepository.save(concurrent);

    await subscriptionRepository.recordPlanChoiceIfAbsent(
      staleRead.id,
      new Date()
    );

    const row = await subscriptionRowOf(user.id);
    expect(row.status).toBe("trialing");
    expect(row.external_reference).toBe("sub_concurrent_trial");
    expect(row.plan_chosen_at).toBeInstanceOf(Date);
  });

  it("never overwrites a recorded choice", async () => {
    const { user } = await createUserFixture({
      name: "Conta Escolha Gravada",
      email: "plan-choice.recorded@sogio.dev",
      password: "password123",
    });
    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("test setup: no subscription");
    const firstChoice = new Date("2026-02-01T09:00:00.000Z");
    await subscriptionRepository.recordPlanChoiceIfAbsent(
      subscription.id,
      firstChoice
    );

    await subscriptionRepository.recordPlanChoiceIfAbsent(
      subscription.id,
      new Date("2026-03-01T09:00:00.000Z")
    );

    const row = await subscriptionRowOf(user.id);
    expect(row.plan_chosen_at).toEqual(firstChoice);
  });
});

describe("confirm_free_plan_choice tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("records the choice through the same use case as the HTTP route", async () => {
    const { user } = await createUserFixture({
      name: "Conta Tool",
      email: "plan-choice.tool@sogio.dev",
      password: "password123",
    });
    const server = new McpServer({ name: "test-server", version: "1.0.0" });
    const registeredTool = registerMcpTool(
      server,
      user,
      CapabilitySet.of({}),
      new BillingDi().makeConfirmFreePlanChoiceTool()
    );
    const extra: RequestHandlerExtra<ServerRequest, ServerNotification> = {
      signal: new AbortController().signal,
      requestId: "test-request-id",
      sendNotification: async () => {},
      sendRequest: () => {
        throw new Error("not implemented in test stub");
      },
    };

    const handler = registeredTool.handler as ToolCallback<z.ZodRawShape>;
    const result = await handler({}, extra);

    expect(result.isError).toBeUndefined();
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(JSON.parse(text)).toEqual({ success: true });
    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    expect(subscription?.needs_plan_choice).toBe(false);
    expect(subscription?.plan_id).toBe(FREE_PLAN_ID);
  });
});
