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
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { PropertyManagementDi } from "../../src/property_management/infra/di/property_management_di";
import { makeTestEntitlementService } from "../helpers/entitlement_service";
import { makeTestPropertyOccupancy } from "../helpers/property_occupancy";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";

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

/**
 * Identity resolution now happens once, at the `/mcp` transport gate
 * (`routes.ts`), before a tool is ever registered — see `mcp_tool.ts`. Tools
 * are registered bound to the already-resolved `user`, so these tests
 * simulate that by passing the fixture user straight into `registerMcpTool`.
 */
function registerListPropertiesTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const propertyManagementDi = new PropertyManagementDi(
    makeTestEntitlementService(),
    makeTestPropertyOccupancy()
  );

  return registerMcpTool(
    server,
    user,
    propertyManagementDi.makeListPropertiesTool()
  );
}

describe("list_properties tool", () => {
  beforeEach(async () => {
    await truncate(["properties", "addresses", "users"]);
  });

  it("returns only the properties administered by the authenticated user", async () => {
    const { user: owner } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const { user: otherUser } = await createUserFixture({
      name: "Maria Souza",
      email: "maria@sogio.dev",
      password: "password123",
    });
    const ownedProperty = await createPropertyFixture({
      userId: owner.id,
      name: "Casa da Praia",
    });
    await createPropertyFixture({
      userId: otherUser.id,
      name: "Apê do Centro",
    });

    const registeredTool = registerListPropertiesTool(owner);
    const result = await callTool(registeredTool, {}, makeExtra());

    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    const output = JSON.parse(text) as {
      properties: Array<{ id: string; name: string }>;
    };

    expect(output.properties).toEqual([
      { id: ownedProperty.id, name: "Casa da Praia" },
    ]);
  });
});
