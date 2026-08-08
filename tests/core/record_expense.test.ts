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
import { MiddlewareDi } from "../../src/auth/infra/di/middleware";
import { db } from "../../src/core/infra/database/drizzle/database";
import { ledgerEntriesTable } from "../../src/core/infra/database/drizzle/schema";
import { McpIdentityResolver } from "../../src/core/infra/mcp/identity_resolver";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool";
import {
  inputSchema,
  makeRecordExpenseTool,
} from "../../src/core/infra/mcp/tools/record_expense";
import { FinanceDi } from "../../src/finance/infra/di/finance_di";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";

const TABLES = ["ledger_entries", "properties", "addresses", "users"];

function makeExtra(
  headers?: Record<string, string>
): RequestHandlerExtra<ServerRequest, ServerNotification> {
  return {
    signal: new AbortController().signal,
    requestId: "test-request-id",
    requestInfo: headers ? { headers } : undefined,
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

function makeIdentityResolver(): McpIdentityResolver {
  const middlewareDi = new MiddlewareDi();
  return new McpIdentityResolver(
    middlewareDi.makeAuthRepository(),
    middlewareDi.makeSessionManager()
  );
}

function registerRecordExpenseTool(): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const financeDi = new FinanceDi();

  return registerMcpTool(
    server,
    makeIdentityResolver(),
    makeRecordExpenseTool(financeDi)
  );
}

describe("record_expense tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("records an expense for a property owned by the authenticated user", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@stayhub.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const registeredTool = registerRecordExpenseTool();
    const result = await callTool(
      registeredTool,
      {
        property_id: property.id,
        amount: 1050,
        category: "MANUTENÇÃO",
        description: "Troca de lâmpadas",
      },
      makeExtra({ authorization: `Bearer ${token}` })
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
      email: "joao@stayhub.dev",
      password: "password123",
    });
    const { user: intruder } = await createUserFixture({
      name: "Maria Souza",
      email: "maria@stayhub.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: owner.id });
    const token = await createAuthToken(intruder.id);

    const registeredTool = registerRecordExpenseTool();
    const result = await callTool(
      registeredTool,
      {
        property_id: property.id,
        amount: 1050,
        category: "MANUTENÇÃO",
      },
      makeExtra({ authorization: `Bearer ${token}` })
    );

    expect(result.isError).toBe(true);

    const rows = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));

    expect(rows).toHaveLength(0);
  });

  it("rejects a request without an authorization token", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@stayhub.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const registeredTool = registerRecordExpenseTool();
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
  });
});
