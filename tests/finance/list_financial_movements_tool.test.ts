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
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { FinanceDi } from "../../src/finance/infra/di/finance_di";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";

const TABLES = ["ledger_entries", "properties", "addresses", "users"];

type MovementsPayload = {
  data: Array<{ id: string; amount: number; category: string }>;
  pagination: { total: number; has_next: boolean };
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

function payloadOf(result: CallToolResult): MovementsPayload {
  const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
  return JSON.parse(text) as MovementsPayload;
}

const financeDi = new FinanceDi();

function registerListFinancialMovementsTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });

  return registerMcpTool(
    server,
    user,
    CapabilitySet.of({}),
    financeDi.makeListFinancialMovementsTool()
  );
}

async function registerRevenue(
  user: User,
  propertyId: string,
  amount: number
): Promise<void> {
  await financeDi.makeRecordRevenueUseCase().execute(
    {
      property_id: propertyId,
      amount,
      category: "ESTADIA",
      description: null,
    },
    user
  );
}

describe("list_financial_movements tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("lists the ledger entries of a property owned by the authenticated user", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    await registerRevenue(user, property.id, 250000);
    await financeDi.makeRecordExpenseUseCase().execute(
      {
        property_id: property.id,
        amount: 1050,
        category: "MANUTENÇÃO",
        description: null,
      },
      user
    );

    const registeredTool = registerListFinancialMovementsTool(user);
    const result = await callTool(
      registeredTool,
      { property_id: property.id },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();

    const output = payloadOf(result);
    expect(output.pagination.total).toBe(2);
    expect(
      output.data.map(entry => entry.amount).sort((a, b) => a - b)
    ).toEqual([-1050, 250000]);
  });

  it("paginates the result set", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    await registerRevenue(user, property.id, 100);
    await registerRevenue(user, property.id, 200);
    await registerRevenue(user, property.id, 300);

    const registeredTool = registerListFinancialMovementsTool(user);
    const result = await callTool(
      registeredTool,
      { property_id: property.id, page: 1, limit: 2 },
      makeExtra()
    );

    const output = payloadOf(result);
    expect(output.data).toHaveLength(2);
    expect(output.pagination.total).toBe(3);
    expect(output.pagination.has_next).toBe(true);
  });

  it("rejects listing the ledger of a property that belongs to another user", async () => {
    const { user: owner } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const { user: intruder } = await createUserFixture({
      name: "Maria Souza",
      email: "maria@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: owner.id });
    await registerRevenue(owner, property.id, 250000);

    const registeredTool = registerListFinancialMovementsTool(intruder);
    const result = await callTool(
      registeredTool,
      { property_id: property.id },
      makeExtra()
    );

    expect(result.isError).toBe(true);
  });
});
