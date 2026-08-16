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
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool";
import { makeListPropertySettingsTool } from "../../src/core/infra/mcp/tools/list_property_settings";
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

function registerListPropertySettingsTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const propertyManagementDi = new PropertyManagementDi(
    makeTestEntitlementService(),
    makeTestPropertyOccupancy()
  );

  return registerMcpTool(
    server,
    user,
    makeListPropertySettingsTool(propertyManagementDi)
  );
}

async function createSettingFixture(propertyId: string, user: User) {
  const propertyManagementDi = new PropertyManagementDi(
    makeTestEntitlementService(),
    makeTestPropertyOccupancy()
  );

  return propertyManagementDi.makeCreatePropertySettingUseCase().execute(
    {
      property_id: propertyId,
      key: "checkin_time",
      value: "14:00",
      type: "string",
    },
    user
  );
}

describe("list_property_settings tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("returns only the settings scoped to the requested property, paginated", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const setting = await createSettingFixture(property.id, user);

    const registeredTool = registerListPropertySettingsTool(user);
    const result = await callTool(
      registeredTool,
      { property_id: property.id, page: 1, limit: 20 },
      makeExtra()
    );

    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    const output = JSON.parse(text) as {
      data: Array<{ id: string; key: string; property_id: string }>;
      pagination: { total: number; has_next: boolean };
    };

    expect(result.isError).toBeUndefined();
    expect(output.data).toHaveLength(1);
    expect(output.data[0]?.id).toBe(setting.id);
    expect(output.data[0]?.key).toBe("checkin_time");
    expect(output.data[0]?.property_id).toBe(property.id);
    expect(output.pagination.total).toBe(1);
    expect(output.pagination.has_next).toBe(false);
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

    const registeredTool = registerListPropertySettingsTool(intruder);

    const resultForAnotherOwnersProperty = await callTool(
      registeredTool,
      { property_id: ownerProperty.id, page: 1, limit: 20 },
      makeExtra()
    );
    const resultForNonexistentProperty = await callTool(
      registeredTool,
      { property_id: crypto.randomUUID(), page: 1, limit: 20 },
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
