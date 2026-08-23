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
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { User } from "../../src/auth/domain/entity/user";
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";
import { db } from "../../src/core/infra/database/drizzle/database";
import { ledgerEntriesTable } from "../../src/core/infra/database/drizzle/schema";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { FinanceDi } from "../../src/finance/infra/di/finance_di";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { api } from "../helpers/server";
import { createAuthToken } from "../helpers/fixtures/auth_token";

const TABLES = ["ledger_entries", "properties", "addresses", "users"];

type MovementsBody = { data: Array<{ id: string }> };

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

function registerDeleteLedgerEntryTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const financeDi = new FinanceDi();

  return registerMcpTool(
    server,
    user,
    CapabilitySet.of({}),
    financeDi.makeDeleteLedgerEntryTool()
  );
}

async function recordExpense(
  token: string,
  propertyId: string,
  amount: number
): Promise<string> {
  const res = await api(`/finance/${propertyId}/expense`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: JSON.stringify({
      amount,
      description: "Despesa de teste",
      category: "MANUTENÇÃO",
    }),
  });
  expect(res.status).toBe(204);

  const rows = await db
    .select()
    .from(ledgerEntriesTable)
    .where(
      and(
        eq(ledgerEntriesTable.property_id, propertyId),
        eq(ledgerEntriesTable.amount, -amount)
      )
    );
  const entry = rows[0];
  if (!entry) {
    throw new Error("Failed to create ledger entry fixture");
  }
  return entry.id;
}

describe("delete_ledger_entry tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("soft-deletes a ledger entry owned by the authenticated user", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "delete-tool-happy@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);
    const entryId = await recordExpense(token, property.id, 5000);

    const registeredTool = registerDeleteLedgerEntryTool(user);
    const result = await callTool(
      registeredTool,
      { property_id: property.id, entry_id: entryId },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();

    const rows = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.id, entryId));
    expect(rows[0]?.deleted_at).not.toBeNull();

    const movementsRes = await api(
      `/finance/properties/${property.id}/movements`,
      { headers: { Authorization: "Bearer " + token } }
    );
    const body = (await movementsRes.json()) as MovementsBody;
    expect(body.data.map(entry => entry.id)).not.toContain(entryId);
  });

  it("errors for a ledger entry belonging to another user's property", async () => {
    const { user: owner } = await createUserFixture({
      name: "João Silva",
      email: "delete-tool-owner@sogio.dev",
      password: "password123",
    });
    const { user: intruder } = await createUserFixture({
      name: "Maria Souza",
      email: "delete-tool-intruder@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: owner.id });
    const ownerToken = await createAuthToken(owner.id);
    const entryId = await recordExpense(ownerToken, property.id, 5000);

    const registeredTool = registerDeleteLedgerEntryTool(intruder);
    const result = await callTool(
      registeredTool,
      { property_id: property.id, entry_id: entryId },
      makeExtra()
    );

    expect(result.isError).toBe(true);

    const rows = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.id, entryId));
    expect(rows[0]?.deleted_at).toBeNull();
  });

  it("errors on a second deletion of the same entry", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "delete-tool-twice@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);
    const entryId = await recordExpense(token, property.id, 5000);

    const registeredTool = registerDeleteLedgerEntryTool(user);
    const firstResult = await callTool(
      registeredTool,
      { property_id: property.id, entry_id: entryId },
      makeExtra()
    );
    expect(firstResult.isError).toBeUndefined();

    const secondResult = await callTool(
      registeredTool,
      { property_id: property.id, entry_id: entryId },
      makeExtra()
    );
    expect(secondResult.isError).toBe(true);
  });
});
