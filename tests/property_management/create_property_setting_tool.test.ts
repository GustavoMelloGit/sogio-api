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
import { db } from "../../src/core/infra/database/drizzle/database";
import { propertySettingsTable } from "../../src/core/infra/database/drizzle/schema";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { PropertyManagementDi } from "../../src/property_management/infra/di/property_management_di";
import { makeTestEntitlementService } from "../helpers/entitlement_service";
import { makeTestPropertyOccupancy } from "../helpers/property_occupancy";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";

const TABLES = ["property_settings", "properties", "addresses", "users"];

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

function registerCreatePropertySettingTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const propertyManagementDi = new PropertyManagementDi(
    makeTestEntitlementService(),
    makeTestPropertyOccupancy()
  );

  return registerMcpTool(
    server,
    user,
    propertyManagementDi.makeCreatePropertySettingTool()
  );
}

describe("create_property_setting tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("creates a setting scoped to a property administered by the authenticated user", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const registeredTool = registerCreatePropertySettingTool(user);
    const result = await callTool(
      registeredTool,
      {
        property_id: property.id,
        key: "checkin_time",
        value: "14:00",
        type: "string",
        description: "Check-in time for this property",
      },
      makeExtra()
    );

    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    const output = JSON.parse(text) as { id: string; key: string };

    expect(result.isError).toBeUndefined();
    expect(output.key).toBe("checkin_time");

    const rows = await db
      .select()
      .from(propertySettingsTable)
      .where(eq(propertySettingsTable.id, output.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.property_id).toBe(property.id);
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
    const ownerProperty = await createPropertyFixture({ userId: owner.id });

    const registeredTool = registerCreatePropertySettingTool(intruder);

    const resultForAnotherOwnersProperty = await callTool(
      registeredTool,
      {
        property_id: ownerProperty.id,
        key: "checkin_time",
        value: "14:00",
        type: "string",
      },
      makeExtra()
    );
    const resultForNonexistentProperty = await callTool(
      registeredTool,
      {
        property_id: crypto.randomUUID(),
        key: "checkin_time",
        value: "14:00",
        type: "string",
      },
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

    const rows = await db.select().from(propertySettingsTable);
    expect(rows).toHaveLength(0);
  });
});
