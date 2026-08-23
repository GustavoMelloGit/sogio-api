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
import { db } from "../../src/core/infra/database/drizzle/database";
import { propertiesTable } from "../../src/core/infra/database/drizzle/schema";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { PropertyManagementDi } from "../../src/property_management/infra/di/property_management_di";
import { makeTestEntitlementService } from "../helpers/entitlement_service";
import { makeTestPropertyOccupancy } from "../helpers/property_occupancy";
import { truncate } from "../helpers/database";
import { api } from "../helpers/server";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { upgradeToPro } from "../helpers/fixtures/plan";

const TABLES = ["properties", "addresses", "users"];

const ADDRESS = {
  street: "Avenida Beira Mar",
  number: "1200",
  neighborhood: "Praia do Canto",
  city: "Vitória",
  state: "ES",
  zip_code: "29055-000",
  country: "Brasil",
  complement: "Apto 302",
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

function registerCreatePropertyTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const propertyManagementDi = new PropertyManagementDi(
    makeTestEntitlementService(),
    makeTestPropertyOccupancy()
  );

  return registerMcpTool(
    server,
    user,
    CapabilitySet.of({}),
    propertyManagementDi.makeCreatePropertyTool()
  );
}

function textOf(result: CallToolResult): string {
  return (result.content as Array<{ text: string }>)[0]?.text ?? "";
}

describe("create_property tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("creates a property owned by the authenticated user", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "create-property-tool.owner@sogio.dev",
      password: "password123",
    });

    const registeredTool = registerCreatePropertyTool(user);
    const result = await callTool(
      registeredTool,
      {
        name: "Apartamento Vista Mar",
        address: ADDRESS,
        capacity: 4,
        images: ["https://cdn.sogio.dev/vista-mar/1.jpg"],
      },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();
    const output = JSON.parse(textOf(result)) as {
      id: string;
      user_id: string;
      name: string;
      capacity: number;
    };
    expect(output.user_id).toBe(user.id);
    expect(output.name).toBe("Apartamento Vista Mar");
    expect(output.capacity).toBe(4);

    const rows = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, output.id));
    expect(rows[0]?.user_id).toBe(user.id);
  });

  it("defaults images to an empty list when omitted", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "create-property-tool.no-images@sogio.dev",
      password: "password123",
    });

    const registeredTool = registerCreatePropertyTool(user);
    const result = await callTool(
      registeredTool,
      { name: "Casa Sem Fotos", address: ADDRESS, capacity: 2 },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();
    const output = JSON.parse(textOf(result)) as { images: string[] };
    expect(output.images).toEqual([]);
  });

  it("ignores a user_id sent by the caller and uses the authenticated one", async () => {
    const { user: owner } = await createUserFixture({
      name: "João Silva",
      email: "create-property-tool.spoof-owner@sogio.dev",
      password: "password123",
    });
    const { user: victim } = await createUserFixture({
      name: "Maria Souza",
      email: "create-property-tool.spoof-victim@sogio.dev",
      password: "password123",
    });

    const registeredTool = registerCreatePropertyTool(owner);
    const result = await callTool(
      registeredTool,
      {
        name: "Casa Alheia",
        address: ADDRESS,
        capacity: 2,
        user_id: victim.id,
      },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();
    const output = JSON.parse(textOf(result)) as { user_id: string };
    expect(output.user_id).toBe(owner.id);
  });

  it("is refused at the plan's max_properties limit, by the same path as the HTTP route", async () => {
    const { user: toolUser } = await createUserFixture({
      name: "João Silva",
      email: "create-property-tool.quota-tool@sogio.dev",
      password: "password123",
    });
    await createPropertyFixture({ userId: toolUser.id });

    const registeredTool = registerCreatePropertyTool(toolUser);
    const result = await callTool(
      registeredTool,
      { name: "Segunda Casa", address: ADDRESS, capacity: 2 },
      makeExtra()
    );

    expect(result.isError).toBe(true);

    const { user: httpUser } = await createUserFixture({
      name: "Maria Souza",
      email: "create-property-tool.quota-http@sogio.dev",
      password: "password123",
    });
    await createPropertyFixture({ userId: httpUser.id });
    const token = await createAuthToken(httpUser.id);

    const httpRes = await api("/property", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({
        name: "Segunda Casa",
        address: ADDRESS,
        images: [],
        capacity: 2,
      }),
    });
    expect(httpRes.status).toBe(403);
    const httpBody = (await httpRes.json()) as { message: string };

    expect(textOf(result)).toBe(httpBody.message);
    expect(textOf(result)).toContain("Upgrade your plan");

    const rows = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.user_id, toolUser.id));
    expect(rows).toHaveLength(1);
  });

  it("creates beyond the free limit once the plan allows it", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "create-property-tool.pro@sogio.dev",
      password: "password123",
    });
    await upgradeToPro(user.id);
    await createPropertyFixture({ userId: user.id });

    const registeredTool = registerCreatePropertyTool(user);
    const result = await callTool(
      registeredTool,
      { name: "Segunda Casa", address: ADDRESS, capacity: 2 },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();
    const rows = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.user_id, user.id));
    expect(rows).toHaveLength(2);
  });
});
