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
import { PropertyDi } from "../../src/booking/infra/di/property_di";
import { TenantDi } from "../../src/booking/infra/di/tenant_di";
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";

const TABLES = ["stays", "tenants", "properties", "addresses", "users"];

type TenantPayload = { id: string; name: string; phone: string };

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

function payloadOf(result: CallToolResult): TenantPayload[] {
  const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
  return JSON.parse(text) as TenantPayload[];
}

function registerListTenantsTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const tenantDi = new TenantDi();

  return registerMcpTool(
    server,
    user,
    CapabilitySet.of({}),
    tenantDi.makeListTenantsTool()
  );
}

async function bookStayFixture(
  propertyId: string,
  user: User,
  tenantName: string,
  phone: string,
  checkIn = "2040-06-01T12:00:00.000Z",
  checkOut = "2040-06-03T12:00:00.000Z"
) {
  const propertyDi = new PropertyDi();

  return propertyDi.makeBookStayUseCase().execute(
    {
      guests: 2,
      property_id: propertyId,
      check_in: new Date(checkIn),
      check_out: new Date(checkOut),
      price: 10000,
      source: "DIRECT",
      tenant: { name: tenantName, phone, sex: "FEMALE" },
    },
    user
  );
}

describe("list_tenants tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("lists the guests staying at the properties of the authenticated user", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    await bookStayFixture(property.id, user, "Ana Souza", "5511999990001");
    await bookStayFixture(
      property.id,
      user,
      "Bruno Lima",
      "5511999990002",
      "2040-07-01T12:00:00.000Z",
      "2040-07-05T12:00:00.000Z"
    );

    const registeredTool = registerListTenantsTool(user);
    const result = await callTool(registeredTool, {}, makeExtra());

    expect(result.isError).toBeUndefined();
    expect(
      payloadOf(result)
        .map(tenant => tenant.name)
        .sort()
    ).toEqual(["Ana Souza", "Bruno Lima"]);
  });

  it("filters guests by a partial name", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    await bookStayFixture(property.id, user, "Ana Souza", "5511999990001");
    await bookStayFixture(
      property.id,
      user,
      "Bruno Lima",
      "5511999990002",
      "2040-07-01T12:00:00.000Z",
      "2040-07-05T12:00:00.000Z"
    );

    const registeredTool = registerListTenantsTool(user);
    const result = await callTool(
      registeredTool,
      { query: "sou" },
      makeExtra()
    );

    const tenants = payloadOf(result);
    expect(tenants).toHaveLength(1);
    expect(tenants[0]?.name).toBe("Ana Souza");
  });

  it("never returns a guest of another user's property", async () => {
    const { user: owner } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const { user: outsider } = await createUserFixture({
      name: "Maria Souza",
      email: "maria@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: owner.id });
    await bookStayFixture(property.id, owner, "Ana Souza", "5511999990001");

    const registeredTool = registerListTenantsTool(outsider);
    const result = await callTool(registeredTool, {}, makeExtra());

    expect(result.isError).toBeUndefined();
    expect(payloadOf(result)).toEqual([]);
  });
});
