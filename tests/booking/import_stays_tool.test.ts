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
import { describe, expect, it, beforeEach, spyOn } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { User } from "../../src/auth/domain/entity/user";
import { PropertyDi } from "../../src/booking/infra/di/property_di";
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";
import { db } from "../../src/core/infra/database/drizzle/database";
import {
  ledgerEntriesTable,
  staysTable,
  tenantsTable,
} from "../../src/core/infra/database/drizzle/schema";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { inMemoryEventDispatcher } from "../../src/core/infra/event/in_memory_event_dispatcher";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { api } from "../helpers/server";

const TABLES = [
  "ledger_entries",
  "stays",
  "tenants",
  "properties",
  "addresses",
  "users",
];

type ImportFailureBody = {
  message: string;
  failures: Array<{ row: number; field: string | null; message: string }>;
  truncated: boolean;
};

type StayRecordInput = {
  property_id: string;
  check_in: string;
  check_out: string;
  guests: number;
  price: number;
  source: string;
  tenant_name: string;
  tenant_phone: string;
  tenant_sex: "MALE" | "FEMALE" | "OTHER";
};

function stayRecord(fields: {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  price: number;
  phone: string;
  name?: string;
}): StayRecordInput {
  return {
    property_id: fields.propertyId,
    check_in: fields.checkIn,
    check_out: fields.checkOut,
    guests: 2,
    price: fields.price,
    source: "AIRBNB",
    tenant_name: fields.name ?? "Hóspede Teste",
    tenant_phone: fields.phone,
    tenant_sex: "FEMALE",
  };
}

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

function registerImportStaysTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const propertyDi = new PropertyDi();

  return registerMcpTool(
    server,
    user,
    CapabilitySet.of({}),
    propertyDi.makeImportStaysTool()
  );
}

describe("import_stays tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("imports a batch and writes the revenue for every stay", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-stays-tool-happy@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const registeredTool = registerImportStaysTool(user);
    const result = await callTool(
      registeredTool,
      {
        records: [
          stayRecord({
            propertyId: property.id,
            checkIn: "2030-01-10",
            checkOut: "2030-01-15",
            price: 100000,
            phone: "5511911110001",
          }),
          stayRecord({
            propertyId: property.id,
            checkIn: "2030-02-10",
            checkOut: "2030-02-15",
            price: 200000,
            phone: "5511911110002",
          }),
        ],
      },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();
    const body = JSON.parse(toolResultText(result)) as { imported: number };
    expect(body.imported).toBe(2);

    const stays = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.property_id, property.id));
    expect(stays).toHaveLength(2);

    const entries = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));
    expect(entries).toHaveLength(2);
    expect(entries.every(entry => entry.category === "ESTADIA")).toBe(true);
  });

  it("rejects a batch with two stays that overlap each other, writing nothing (IM-3)", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-stays-tool-overlap-batch@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const registeredTool = registerImportStaysTool(user);
    const result = await callTool(
      registeredTool,
      {
        records: [
          stayRecord({
            propertyId: property.id,
            checkIn: "2031-01-10",
            checkOut: "2031-01-15",
            price: 100000,
            phone: "5511911110003",
          }),
          stayRecord({
            propertyId: property.id,
            checkIn: "2031-01-12",
            checkOut: "2031-01-20",
            price: 100000,
            phone: "5511911110004",
          }),
        ],
      },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();
    const body = JSON.parse(toolResultText(result)) as ImportFailureBody;
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]?.row).toBe(2);
    expect(body.failures[0]?.message).toBe("Property is occupied");

    const stays = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.property_id, property.id));
    expect(stays).toHaveLength(0);
  });

  it("creates a single tenant for ten stays sharing the same phone (IM-3)", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-stays-tool-same-tenant@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const phone = "5511922220000";

    const records = Array.from({ length: 10 }, (_, index) => {
      const month = String(index + 1).padStart(2, "0");
      return stayRecord({
        propertyId: property.id,
        checkIn: `2032-${month}-01`,
        checkOut: `2032-${month}-03`,
        price: 50000,
        phone,
      });
    });

    const registeredTool = registerImportStaysTool(user);
    const result = await callTool(registeredTool, { records }, makeExtra());

    expect(result.isError).toBeUndefined();
    const body = JSON.parse(toolResultText(result)) as { imported: number };
    expect(body.imported).toBe(10);

    const tenants = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.phone, phone));
    expect(tenants).toHaveLength(1);
  });

  it("IM-5 — tenants created before a late failure do not survive the rejected batch", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-stays-tool-im5@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const phones = ["5511933330001", "5511933330002", "5511933330003"];

    const registeredTool = registerImportStaysTool(user);
    const result = await callTool(
      registeredTool,
      {
        records: [
          stayRecord({
            propertyId: property.id,
            checkIn: "2033-03-01",
            checkOut: "2033-03-05",
            price: 50000,
            phone: phones[0]!,
          }),
          stayRecord({
            propertyId: property.id,
            checkIn: "2033-04-01",
            checkOut: "2033-04-05",
            price: 50000,
            phone: phones[1]!,
          }),
          stayRecord({
            propertyId: property.id,
            checkIn: "2033-05-01",
            checkOut: "2033-05-05",
            price: 50000,
            phone: phones[2]!,
          }),
          stayRecord({
            propertyId: property.id,
            checkIn: "2033-03-04",
            checkOut: "2033-03-08",
            price: 50000,
            phone: "5511933330004",
          }),
        ],
      },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();
    const body = JSON.parse(toolResultText(result)) as ImportFailureBody;
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]?.row).toBe(4);

    const stays = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.property_id, property.id));
    expect(stays).toHaveLength(0);

    const tenants = await db
      .select()
      .from(tenantsTable)
      .where(inArray(tenantsTable.phone, phones));
    expect(tenants).toHaveLength(0);
  });

  it("IM-2 — overlap with an already-existing stay is a row-level failure", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-stays-tool-existing-overlap@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const bookRes = await api(`/booking/property/${property.id}/book`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({
        guests: 2,
        check_in: "2034-05-10T12:00:00.000Z",
        check_out: "2034-05-15T12:00:00.000Z",
        price: 90000,
        source: "DIRECT",
        tenant: {
          name: "Hóspede Existente",
          phone: "5511944440000",
          sex: "FEMALE",
        },
      }),
    });
    expect(bookRes.status).toBe(200);

    const registeredTool = registerImportStaysTool(user);
    const result = await callTool(
      registeredTool,
      {
        records: [
          stayRecord({
            propertyId: property.id,
            checkIn: "2034-05-14",
            checkOut: "2034-05-18",
            price: 100000,
            phone: "5511944440001",
          }),
        ],
      },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();
    const body = JSON.parse(toolResultText(result)) as ImportFailureBody;
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]?.row).toBe(1);
    expect(body.failures[0]?.message).toBe("Property is occupied");

    const stays = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.property_id, property.id));
    expect(stays).toHaveLength(1);
  });

  it("IM-4 — a stay import dispatches stay_imported, never stay_booked", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-stays-tool-no-lock@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const dispatchSpy = spyOn(inMemoryEventDispatcher, "dispatch");

    const registeredTool = registerImportStaysTool(user);
    const result = await callTool(
      registeredTool,
      {
        records: [
          stayRecord({
            propertyId: property.id,
            checkIn: "2035-06-10",
            checkOut: "2035-06-15",
            price: 100000,
            phone: "5511955550000",
          }),
        ],
      },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();

    const dispatchedEventNames = dispatchSpy.mock.calls.map(
      ([event]) => event.name
    );
    dispatchSpy.mockRestore();

    expect(dispatchedEventNames).toContain("stay_imported");
    expect(dispatchedEventNames).not.toContain("stay_booked");
  });
});
