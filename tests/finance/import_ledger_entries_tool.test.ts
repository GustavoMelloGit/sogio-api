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

type ImportFailureBody = {
  message: string;
  failures: Array<{ row: number; field: string | null; message: string }>;
  truncated: boolean;
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

function toolResultText(result: CallToolResult): string {
  const first = result.content[0];
  if (!first || first.type !== "text") {
    throw new Error("Expected a text content block");
  }
  return first.text;
}

function registerImportLedgerEntriesTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const financeDi = new FinanceDi();

  return registerMcpTool(
    server,
    user,
    CapabilitySet.of({ bulk_import: true }),
    financeDi.makeImportLedgerEntriesTool()
  );
}

describe("import_ledger_entries tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("imports a batch and writes every record", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-tool-happy@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const registeredTool = registerImportLedgerEntriesTool(user);
    const result = await callTool(
      registeredTool,
      {
        records: [
          {
            property_id: property.id,
            kind: "expense",
            amount: 15000,
            category: "MANUTENÇÃO",
            description: "Reparo no encanamento",
          },
          {
            property_id: property.id,
            kind: "revenue",
            amount: 120000,
            category: "ESTADIA",
          },
        ],
      },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();
    const body = JSON.parse(toolResultText(result)) as { imported: number };
    expect(body.imported).toBe(2);

    const rows = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));
    expect(rows).toHaveLength(2);
  });

  it("rejects a batch with invalid records and writes nothing", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-tool-rejected@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const registeredTool = registerImportLedgerEntriesTool(user);
    const result = await callTool(
      registeredTool,
      {
        records: [
          {
            property_id: property.id,
            kind: "expense",
            amount: 15000,
            category: "MANUTENÇÃO",
          },
          {
            property_id: property.id,
            kind: "expense",
            amount: 3000,
            category: "CATEGORIA_INVALIDA",
          },
        ],
      },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();
    const body = JSON.parse(toolResultText(result)) as ImportFailureBody;
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]?.row).toBe(2);

    const rows = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));
    expect(rows).toHaveLength(0);
  });

  it("a property_id belonging to another user is a row-level failure, not a tool error", async () => {
    const { user: owner } = await createUserFixture({
      name: "João Silva",
      email: "import-tool-owner@sogio.dev",
      password: "password123",
    });
    const { user: intruder } = await createUserFixture({
      name: "Maria Souza",
      email: "import-tool-intruder@sogio.dev",
      password: "password123",
    });
    const ownedProperty = await createPropertyFixture({ userId: owner.id });

    const registeredTool = registerImportLedgerEntriesTool(intruder);
    const result = await callTool(
      registeredTool,
      {
        records: [
          {
            property_id: ownedProperty.id,
            kind: "expense",
            amount: 15000,
            category: "MANUTENÇÃO",
          },
        ],
      },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();
    const body = JSON.parse(toolResultText(result)) as ImportFailureBody;
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]?.field).toBe("property_id");

    const rows = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, ownedProperty.id));
    expect(rows).toHaveLength(0);
  });

  it("IM-6 — a historical occurred_at is reflected by find_property_financial_movements", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-tool-historical@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const registeredTool = registerImportLedgerEntriesTool(user);
    const result = await callTool(
      registeredTool,
      {
        records: [
          {
            property_id: property.id,
            kind: "expense",
            amount: 15000,
            category: "MANUTENÇÃO",
            occurred_at: "15/01/2026",
          },
        ],
      },
      makeExtra()
    );
    expect(result.isError).toBeUndefined();

    const movementsRes = await api(
      `/finance/properties/${property.id}/movements`,
      { headers: { Authorization: "Bearer " + token } }
    );
    const body = (await movementsRes.json()) as {
      data: Array<{ created_at: string }>;
    };

    expect(movementsRes.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.created_at.slice(0, 10)).toBe("2026-01-15");
  });

  it("IM-5 — a failure on the last record of a longer batch leaves no trace of the previous ones", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-tool-im5@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const registeredTool = registerImportLedgerEntriesTool(user);
    const result = await callTool(
      registeredTool,
      {
        records: [
          {
            property_id: property.id,
            kind: "expense",
            amount: 1000,
            category: "MANUTENÇÃO",
          },
          {
            property_id: property.id,
            kind: "revenue",
            amount: 2000,
            category: "ESTADIA",
          },
          {
            property_id: property.id,
            kind: "expense",
            amount: 3000,
            category: "CATEGORIA_INVALIDA",
          },
        ],
      },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();
    const body = JSON.parse(toolResultText(result)) as ImportFailureBody;
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]?.row).toBe(3);

    const rows = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));
    expect(rows).toHaveLength(0);
  });
});
