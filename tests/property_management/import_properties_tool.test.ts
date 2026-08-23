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
import type { z } from "zod";
import type { User } from "../../src/auth/domain/entity/user";
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { PropertyManagementDi } from "../../src/property_management/infra/di/property_management_di";
import { db } from "../../src/core/infra/database/drizzle/database";
import {
  propertiesTable,
  subscriptionsTable,
} from "../../src/core/infra/database/drizzle/schema";
import { makeTestEntitlementService } from "../helpers/entitlement_service";
import { makeTestPropertyOccupancy } from "../helpers/property_occupancy";
import { truncate } from "../helpers/database";
import { api } from "../helpers/server";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { PRO_PLAN_ID } from "../helpers/fixtures/plan";

const TABLES = ["properties", "addresses", "users"];

type PropertyRecordInput = {
  name: string;
  capacity: number;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
};

function propertyRecord(
  name: string,
  overrides: Partial<PropertyRecordInput> = {}
): PropertyRecordInput {
  return {
    name,
    capacity: 2,
    street: "Avenida Beira Mar",
    number: "1200",
    neighborhood: "Praia do Canto",
    city: "Vitória",
    state: "ES",
    zip_code: "29055-000",
    country: "Brasil",
    ...overrides,
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

function registerImportPropertiesTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const propertyManagementDi = new PropertyManagementDi(
    makeTestEntitlementService(),
    makeTestPropertyOccupancy()
  );

  return registerMcpTool(
    server,
    user,
    CapabilitySet.of({}),
    propertyManagementDi.makeImportPropertiesTool()
  );
}

async function upgradeToPro(userId: string): Promise<void> {
  await db
    .update(subscriptionsTable)
    .set({ plan_id: PRO_PLAN_ID })
    .where(eq(subscriptionsTable.user_id, userId));
}

async function countPropertiesOfUser(userId: string): Promise<number> {
  const rows = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.user_id, userId));
  return rows.length;
}

function textOf(result: CallToolResult): string {
  return (result.content as Array<{ text: string }>)[0]?.text ?? "";
}

describe("import_properties tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("imports an accepted batch without images and persists the properties", async () => {
    const { user } = await createUserFixture({
      name: "Dono de Imóvel",
      email: "import-tool.accepted@sogio.dev",
      password: "password123",
    });
    await upgradeToPro(user.id);

    const registeredTool = registerImportPropertiesTool(user);
    const result = await callTool(
      registeredTool,
      {
        records: [
          propertyRecord("Apartamento Vista Mar"),
          propertyRecord("Casa de Praia"),
        ],
      },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();
    const output = JSON.parse(textOf(result)) as { imported: number };
    expect(output.imported).toBe(2);

    const rows = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.user_id, user.id));
    const names = rows.map(row => row.name).sort();
    expect(names).toEqual(["Apartamento Vista Mar", "Casa de Praia"]);
    expect(rows.every(row => row.images.length === 0)).toBe(true);
  });

  it("rejects a batch that would exceed max_properties in its entirety, not truncated", async () => {
    const { user } = await createUserFixture({
      name: "Dono de Imóvel",
      email: "import-tool.quota-batch@sogio.dev",
      password: "password123",
    });

    const registeredTool = registerImportPropertiesTool(user);
    const result = await callTool(
      registeredTool,
      {
        records: [
          propertyRecord("Casa 1"),
          propertyRecord("Casa 2"),
          propertyRecord("Casa 3"),
        ],
      },
      makeExtra()
    );

    expect(result.isError).toBe(true);
    expect(await countPropertiesOfUser(user.id)).toBe(0);
  });

  it("counts the batch's own inserts cumulatively against the quota (IM-3)", async () => {
    const { user } = await createUserFixture({
      name: "Dono de Imóvel",
      email: "import-tool.quota-cumulative@sogio.dev",
      password: "password123",
    });
    await upgradeToPro(user.id);
    await createPropertyFixture({ userId: user.id, name: "Existente 1" });
    await createPropertyFixture({ userId: user.id, name: "Existente 2" });
    await createPropertyFixture({ userId: user.id, name: "Existente 3" });

    const registeredTool = registerImportPropertiesTool(user);
    const result = await callTool(
      registeredTool,
      {
        records: [
          propertyRecord("Nova 1"),
          propertyRecord("Nova 2"),
          propertyRecord("Nova 3"),
        ],
      },
      makeExtra()
    );

    expect(result.isError).toBe(true);
    expect(await countPropertiesOfUser(user.id)).toBe(3);
  });

  it("produces the same upgrade message as the unit path when the quota is exceeded (IM-2)", async () => {
    const { user: unitPathUser } = await createUserFixture({
      name: "Dono de Imóvel",
      email: "import-tool.im2-unit@sogio.dev",
      password: "password123",
    });
    await createPropertyFixture({ userId: unitPathUser.id });
    const unitPathToken = await createAuthToken(unitPathUser.id);

    const unitPathRes = await api("/property", {
      method: "POST",
      headers: { Authorization: "Bearer " + unitPathToken },
      body: JSON.stringify({
        name: "Segunda Casa",
        address: {
          street: "Rua X",
          number: "1",
          neighborhood: "Centro",
          city: "São Paulo",
          state: "SP",
          zip_code: "01310-100",
          country: "Brasil",
          complement: "",
        },
        images: [],
        capacity: 2,
      }),
    });
    expect(unitPathRes.status).toBe(403);
    const unitPathBody = (await unitPathRes.json()) as { message: string };

    const { user: importUser } = await createUserFixture({
      name: "Dono de Imóvel",
      email: "import-tool.im2-batch@sogio.dev",
      password: "password123",
    });
    await createPropertyFixture({ userId: importUser.id });

    const registeredTool = registerImportPropertiesTool(importUser);
    const result = await callTool(
      registeredTool,
      { records: [propertyRecord("Terceira Casa")] },
      makeExtra()
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(unitPathBody.message);
  });

  it("returns row-level failures without persisting anything for an invalid record", async () => {
    const { user } = await createUserFixture({
      name: "Dono de Imóvel",
      email: "import-tool.invalid-row@sogio.dev",
      password: "password123",
    });
    await upgradeToPro(user.id);

    const registeredTool = registerImportPropertiesTool(user);
    const result = await callTool(
      registeredTool,
      {
        records: [
          propertyRecord("Casa Válida"),
          propertyRecord("Casa Inválida", { capacity: -1 }),
        ],
      },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();
    const output = JSON.parse(textOf(result)) as {
      message: string;
      failures: Array<{ row: number; field: string | null; message: string }>;
      truncated: boolean;
    };
    expect(output.truncated).toBe(false);
    expect(output.failures).toHaveLength(1);
    expect(output.failures[0]?.row).toBe(2);
    expect(output.failures[0]?.field).toBe("capacity");
    expect(await countPropertiesOfUser(user.id)).toBe(0);
  });
});
