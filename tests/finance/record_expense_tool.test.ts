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
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { User } from "../../src/auth/domain/entity/user";
import { db } from "../../src/core/infra/database/drizzle/database";
import { ledgerEntriesTable } from "../../src/core/infra/database/drizzle/schema";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { inputSchema } from "../../src/finance/presentation/mcp_tool/record_expense.mcp_tool";
import { FinanceDi } from "../../src/finance/infra/di/finance_di";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";

const TABLES = ["ledger_entries", "properties", "addresses", "users"];

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

/**
 * Identity resolution now happens once, at the `/mcp` transport gate
 * (`routes.ts`), before a tool is ever registered — see `mcp_tool.ts`. Tools
 * are registered bound to the already-resolved `user`, so these tests
 * simulate that by passing the fixture user straight into `registerMcpTool`.
 */
function registerRecordExpenseTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const financeDi = new FinanceDi();

  return registerMcpTool(server, user, financeDi.makeRecordExpenseTool());
}

describe("record_expense tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("records an expense for a property owned by the authenticated user", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const registeredTool = registerRecordExpenseTool(user);
    const result = await callTool(
      registeredTool,
      {
        property_id: property.id,
        amount: 1050,
        category: "MANUTENÇÃO",
        description: "Troca de lâmpadas",
      },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();

    const rows = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe(-1050);
    expect(rows[0]?.category).toBe("MANUTENÇÃO");
    expect(rows[0]?.description).toBe("Troca de lâmpadas");
  });

  it("rejects a category outside the closed vocabulary before the use case is invoked", () => {
    const parsed = z.object(inputSchema).safeParse({
      property_id: crypto.randomUUID(),
      amount: 1050,
      category: "CATEGORIA_INVALIDA",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an expense for a property that belongs to another user", async () => {
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

    const registeredTool = registerRecordExpenseTool(intruder);
    const result = await callTool(
      registeredTool,
      {
        property_id: property.id,
        amount: 1050,
        category: "MANUTENÇÃO",
      },
      makeExtra()
    );

    expect(result.isError).toBe(true);

    const rows = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));

    expect(rows).toHaveLength(0);
  });
});
