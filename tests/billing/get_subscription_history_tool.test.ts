import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import {
  McpServer,
  type RegisteredTool,
  type ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, beforeEach } from "bun:test";
import { z } from "zod";
import type { User } from "../../src/auth/domain/entity/user";
import { BillingDi } from "../../src/billing/infra/di/billing_di";
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { inputSchema } from "../../src/billing/presentation/mcp_tool/get_subscription_history.mcp_tool";
import { GrantPlanUseCase } from "../../src/billing/application/use_case/grant_plan";
import { CancelSubscriptionUseCase } from "../../src/billing/application/use_case/cancel_subscription";
import { SubscriptionPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";
import { PlanPostgresRepository } from "../../src/billing/infra/database/postgres_repository/plan_postgres_repository";
import { inMemoryEventDispatcher } from "../../src/core/infra/event/in_memory_event_dispatcher";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { seedPlans } from "../helpers/fixtures/plan";

const TABLES = ["users"];

const subscriptionRepository = new SubscriptionPostgresRepository();
const planRepository = new PlanPostgresRepository();
const grantPlanUseCase = new GrantPlanUseCase(
  subscriptionRepository,
  planRepository,
  inMemoryEventDispatcher
);
const cancelSubscriptionUseCase = new CancelSubscriptionUseCase(
  subscriptionRepository,
  planRepository,
  inMemoryEventDispatcher
);

type HistoryEntryPayload = {
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

type HistoryPayload = {
  data: HistoryEntryPayload[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
    has_next: boolean;
    has_previous: boolean;
  };
};

function makeExtra(): RequestHandlerExtra<ServerRequest, ServerNotification> {
  return {
    signal: new AbortController().signal,
    requestId: "test-request-id",
    sendNotification: async () => {},
    sendRequest: () => {
      throw new Error("not implemented in test stub");
    },
  };
}

async function callTool(
  registeredTool: RegisteredTool,
  input: Record<string, unknown>,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
): Promise<CallToolResult> {
  const handler = registeredTool.handler as ToolCallback<z.ZodRawShape>;
  return handler(input, extra);
}

function registerGetSubscriptionHistoryTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const billingDi = new BillingDi();

  return registerMcpTool(
    server,
    user,
    CapabilitySet.of({}),
    billingDi.makeGetSubscriptionHistoryTool()
  );
}

function parsedArgs(raw: Record<string, unknown>): Record<string, unknown> {
  return z.object(inputSchema).parse(raw);
}

describe("get_subscription_history tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
    await seedPlans();
  });

  it("returns the caller's own subscription history, most recent first", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    await grantPlanUseCase.execute({ plan_code: "pro" }, user);
    await cancelSubscriptionUseCase.execute({ user_id: user.id });

    const registeredTool = registerGetSubscriptionHistoryTool(user);
    const result = await callTool(registeredTool, parsedArgs({}), makeExtra());

    expect(result.isError).toBeUndefined();

    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    const payload = JSON.parse(text) as HistoryPayload;

    expect(payload.pagination.total).toBe(3);
    expect(payload.data.map(entry => entry.type)).toEqual([
      "canceled",
      "plan_changed",
      "started",
    ]);
  });

  it("only returns the caller's own entries, never another user's", async () => {
    const { user: userA } = await createUserFixture({
      name: "Conta A",
      email: "conta-a@sogio.dev",
      password: "password123",
    });
    await grantPlanUseCase.execute({ plan_code: "pro" }, userA);
    await cancelSubscriptionUseCase.execute({ user_id: userA.id });

    const { user: userB } = await createUserFixture({
      name: "Conta B",
      email: "conta-b@sogio.dev",
      password: "password123",
    });

    const resultA = await callTool(
      registerGetSubscriptionHistoryTool(userA),
      parsedArgs({}),
      makeExtra()
    );
    const resultB = await callTool(
      registerGetSubscriptionHistoryTool(userB),
      parsedArgs({}),
      makeExtra()
    );

    const textA = (resultA.content as Array<{ text: string }>)[0]?.text ?? "";
    const textB = (resultB.content as Array<{ text: string }>)[0]?.text ?? "";
    const payloadA = JSON.parse(textA) as HistoryPayload;
    const payloadB = JSON.parse(textB) as HistoryPayload;

    expect(payloadA.pagination.total).toBe(3);
    expect(payloadB.pagination.total).toBe(1);
    expect(payloadB.data.map(entry => entry.type)).toEqual(["started"]);
  });

  it("paginates using page and limit", async () => {
    const { user } = await createUserFixture({
      name: "Conta Paginada",
      email: "conta-paginada@sogio.dev",
      password: "password123",
    });
    await grantPlanUseCase.execute({ plan_code: "pro" }, user);
    await cancelSubscriptionUseCase.execute({ user_id: user.id });

    const registeredTool = registerGetSubscriptionHistoryTool(user);

    const firstPage = await callTool(
      registeredTool,
      parsedArgs({ page: "1", limit: "2" }),
      makeExtra()
    );
    const firstText =
      (firstPage.content as Array<{ text: string }>)[0]?.text ?? "";
    const firstPayload = JSON.parse(firstText) as HistoryPayload;

    expect(firstPayload.data).toHaveLength(2);
    expect(firstPayload.pagination.total).toBe(3);
    expect(firstPayload.pagination.has_next).toBe(true);
    expect(firstPayload.data.map(entry => entry.type)).toEqual([
      "canceled",
      "plan_changed",
    ]);

    const secondPage = await callTool(
      registeredTool,
      parsedArgs({ page: "2", limit: "2" }),
      makeExtra()
    );
    const secondText =
      (secondPage.content as Array<{ text: string }>)[0]?.text ?? "";
    const secondPayload = JSON.parse(secondText) as HistoryPayload;

    expect(secondPayload.data).toHaveLength(1);
    expect(secondPayload.pagination.has_next).toBe(false);
    expect(secondPayload.data.map(entry => entry.type)).toEqual(["started"]);
  });
});
