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
import type { z } from "zod";
import type { User } from "../../src/auth/domain/entity/user";
import { BillingDi } from "../../src/billing/infra/di/billing_di";
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { seedPlans } from "../helpers/fixtures/plan";

const TABLES = ["users"];

type PlanPayload = {
  code: string;
  name: string;
  price_amount: number;
  trial_days: number;
  capabilities: Record<string, boolean | number>;
  external_price_reference?: string | null;
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

function registerListPlansTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const billingDi = new BillingDi();

  return registerMcpTool(
    server,
    user,
    CapabilitySet.of({}),
    billingDi.makeListPlansTool()
  );
}

describe("list_plans tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
    await seedPlans();
  });

  it("lists every offered plan with the capabilities it unlocks", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });

    const registeredTool = registerListPlansTool(user);
    const result = await callTool(registeredTool, {}, makeExtra());

    expect(result.isError).toBeUndefined();

    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    const plans = JSON.parse(text) as PlanPayload[];
    const pro = plans.find(plan => plan.code === "pro");

    expect(plans.length).toBeGreaterThan(0);
    expect(pro).toBeDefined();
    expect(pro?.capabilities).toEqual({
      max_properties: 5,
      export_reports: true,
      bulk_import: true,
    });
    expect(pro?.price_amount).toBe(2500);
    expect(pro?.trial_days).toBe(14);
  });

  it("never exposes the payment gateway price reference", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });

    const registeredTool = registerListPlansTool(user);
    const result = await callTool(registeredTool, {}, makeExtra());

    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    const plans = JSON.parse(text) as PlanPayload[];

    plans.forEach(plan => {
      expect(plan).not.toHaveProperty("external_price_reference");
    });
  });
});
