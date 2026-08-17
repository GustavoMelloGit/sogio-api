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
import { PropertyDi } from "../../src/booking/infra/di/property_di";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool";
import { makeListPropertiesTool } from "../../src/core/infra/mcp/tools/list_properties";
import { makeBookStayTool } from "../../src/core/infra/mcp/tools/book_stay";
import { makeListPropertySettingsTool } from "../../src/core/infra/mcp/tools/list_property_settings";
import { makeGetPropertySettingTool } from "../../src/core/infra/mcp/tools/get_property_setting";
import { makeCreatePropertySettingTool } from "../../src/core/infra/mcp/tools/create_property_setting";
import { makeUpdatePropertySettingTool } from "../../src/core/infra/mcp/tools/update_property_setting";
import { makeDeletePropertySettingTool } from "../../src/core/infra/mcp/tools/delete_property_setting";
import { makeDeletePropertyTool } from "../../src/core/infra/mcp/tools/delete_property";
import { PropertyManagementDi } from "../../src/property_management/infra/di/property_management_di";
import { makeTestEntitlementService } from "../helpers/entitlement_service";
import { makeTestPropertyOccupancy } from "../helpers/property_occupancy";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { api } from "../helpers/server";
import { createAuthToken } from "../helpers/fixtures/auth_token";

const TABLES = [
  "stays",
  "tenants",
  "property_settings",
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

function makePropertyManagementDi(): PropertyManagementDi {
  return new PropertyManagementDi(
    makeTestEntitlementService(),
    makeTestPropertyOccupancy()
  );
}

async function deleteProperty(userId: string, propertyId: string) {
  const token = await createAuthToken(userId);
  const res = await api(`/property/${propertyId}`, {
    method: "DELETE",
    headers: { Authorization: "Bearer " + token },
  });
  if (res.status !== 200) {
    throw new Error(`fixture setup: expected 200, got ${res.status}`);
  }
}

/**
 * MCP tools bypass `BunHttpControllerAdapter` entirely, so the HTTP-level
 * sweep (`delete_property.test.ts`) does not exercise them — R-7 requires
 * covering them separately.
 */
describe("MCP tools do not surface a deleted property (R-7)", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("list_properties omits the deleted property", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    await deleteProperty(user.id, property.id);

    const server = new McpServer({ name: "test-server", version: "1.0.0" });
    const registeredTool = registerMcpTool(
      server,
      user,
      makeListPropertiesTool(makePropertyManagementDi())
    );
    const result = await callTool(registeredTool, {}, makeExtra());
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    const output = JSON.parse(text) as {
      properties: Array<{ id: string }>;
    };

    expect(output.properties.map(p => p.id)).not.toContain(property.id);
  });

  it("book_stay refuses to book the deleted property", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    await deleteProperty(user.id, property.id);

    const server = new McpServer({ name: "test-server", version: "1.0.0" });
    const registeredTool = registerMcpTool(
      server,
      user,
      makeBookStayTool(new PropertyDi())
    );
    const result = await callTool(
      registeredTool,
      {
        property_id: property.id,
        guests: 2,
        check_in: new Date("2040-06-01T12:00:00-03:00"),
        check_out: new Date("2040-06-03T12:00:00-03:00"),
        price: 10000,
        source: "DIRECT",
        tenant: { name: "Ana Souza", phone: "5511999990001", sex: "FEMALE" },
      },
      makeExtra()
    );

    expect(result.isError).toBe(true);
  });

  it("list_property_settings, get_property_setting, create_property_setting, update_property_setting and delete_property_setting all reject the deleted property", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const propertyManagementDi = makePropertyManagementDi();
    const setting = await propertyManagementDi
      .makeCreatePropertySettingUseCase()
      .execute(
        {
          property_id: property.id,
          key: "checkin_time",
          value: "14:00",
          type: "string",
          description: null,
        },
        user
      );

    await deleteProperty(user.id, property.id);

    const server = new McpServer({ name: "test-server", version: "1.0.0" });

    const listResult = await callTool(
      registerMcpTool(
        server,
        user,
        makeListPropertySettingsTool(makePropertyManagementDi())
      ),
      { property_id: property.id, page: 1, limit: 20 },
      makeExtra()
    );
    expect(listResult.isError).toBe(true);

    const getResult = await callTool(
      registerMcpTool(
        server,
        user,
        makeGetPropertySettingTool(makePropertyManagementDi())
      ),
      { property_id: property.id, id: setting.id },
      makeExtra()
    );
    expect(getResult.isError).toBe(true);

    const createResult = await callTool(
      registerMcpTool(
        server,
        user,
        makeCreatePropertySettingTool(makePropertyManagementDi())
      ),
      {
        property_id: property.id,
        key: "another_key",
        value: "value",
        type: "string",
      },
      makeExtra()
    );
    expect(createResult.isError).toBe(true);

    const updateResult = await callTool(
      registerMcpTool(
        server,
        user,
        makeUpdatePropertySettingTool(makePropertyManagementDi())
      ),
      { property_id: property.id, id: setting.id, value: "15:00" },
      makeExtra()
    );
    expect(updateResult.isError).toBe(true);

    const deleteResult = await callTool(
      registerMcpTool(
        server,
        user,
        makeDeletePropertySettingTool(makePropertyManagementDi())
      ),
      { property_id: property.id, id: setting.id },
      makeExtra()
    );
    expect(deleteResult.isError).toBe(true);
  });

  it("delete_property refuses to act again on the already-deleted property", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const server = new McpServer({ name: "test-server", version: "1.0.0" });
    const registeredTool = registerMcpTool(
      server,
      user,
      makeDeletePropertyTool(makePropertyManagementDi())
    );

    // Deleting through the tool itself, rather than the `deleteProperty`
    // HTTP fixture helper other tests in this file use, so setting up this
    // test's precondition doesn't spend any of
    // DeletePropertyController's process-wide, per-IP rate limit budget —
    // MCP tools call the use case directly and never reach that controller.
    const firstResult = await callTool(
      registeredTool,
      { property_id: property.id },
      makeExtra()
    );
    expect(firstResult.isError).toBeUndefined();

    const secondResult = await callTool(
      registeredTool,
      { property_id: property.id },
      makeExtra()
    );
    expect(secondResult.isError).toBe(true);
  });
});
