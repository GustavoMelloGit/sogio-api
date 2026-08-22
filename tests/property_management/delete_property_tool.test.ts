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
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { api } from "../helpers/server";

const TABLES = [
  "stays",
  "tenants",
  "ledger_entries",
  "properties",
  "addresses",
  "users",
];

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

function registerDeletePropertyTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const propertyManagementDi = new PropertyManagementDi(
    makeTestEntitlementService(),
    makeTestPropertyOccupancy()
  );

  return registerMcpTool(
    server,
    user,
    CapabilitySet.of({}),
    propertyManagementDi.makeDeletePropertyTool()
  );
}

async function bookStay(
  token: string,
  propertyId: string,
  period: { check_in: string; check_out: string }
): Promise<Response> {
  return api(`/booking/property/${propertyId}/book`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: JSON.stringify({
      guests: 2,
      check_in: period.check_in,
      check_out: period.check_out,
      price: 10000,
      source: "DIRECT",
      tenant: { name: "Ana Souza", phone: "5511999990001", sex: "FEMALE" },
    }),
  });
}

describe("delete_property tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("deletes the property, cancels its future stays in cascade and returns canceled_stays", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const bookRes = await bookStay(token, property.id, {
      check_in: "2040-06-01T12:00:00.000Z",
      check_out: "2040-06-03T12:00:00.000Z",
    });
    expect(bookRes.status).toBe(200);

    const registeredTool = registerDeletePropertyTool(user);
    const result = await callTool(
      registeredTool,
      { property_id: property.id },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    const output = JSON.parse(text) as { canceled_stays: number };
    expect(output.canceled_stays).toBe(1);

    const rows = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, property.id));
    expect(rows[0]?.deleted_at).not.toBeNull();
  });

  it("refuses to delete a property with a guest checked in right now", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const now = new Date();
    const checkIn = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const checkOut = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const bookRes = await bookStay(token, property.id, {
      check_in: checkIn.toISOString(),
      check_out: checkOut.toISOString(),
    });
    expect(bookRes.status).toBe(200);

    const registeredTool = registerDeletePropertyTool(user);
    const result = await callTool(
      registeredTool,
      { property_id: property.id },
      makeExtra()
    );

    expect(result.isError).toBe(true);

    const rows = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, property.id));
    expect(rows[0]?.deleted_at).toBeNull();
  });

  it("does not distinguish another owner's property from a nonexistent one", async () => {
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

    const registeredTool = registerDeletePropertyTool(intruder);

    const resultForAnotherOwnersProperty = await callTool(
      registeredTool,
      { property_id: property.id },
      makeExtra()
    );
    const resultForNonexistentProperty = await callTool(
      registeredTool,
      { property_id: crypto.randomUUID() },
      makeExtra()
    );

    expect(resultForAnotherOwnersProperty.isError).toBe(true);
    expect(resultForNonexistentProperty.isError).toBe(true);

    const textForAnotherOwnersProperty =
      (resultForAnotherOwnersProperty.content as Array<{ text: string }>)[0]
        ?.text ?? "";
    const textForNonexistentProperty =
      (resultForNonexistentProperty.content as Array<{ text: string }>)[0]
        ?.text ?? "";
    expect(textForAnotherOwnersProperty).toBe(textForNonexistentProperty);
  });
});
