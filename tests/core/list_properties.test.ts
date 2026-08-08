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
import { MiddlewareDi } from "../../src/auth/infra/di/middleware";
import { McpIdentityResolver } from "../../src/core/infra/mcp/identity_resolver";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool";
import { makeListPropertiesTool } from "../../src/core/infra/mcp/tools/list_properties";
import { PropertyManagementDi } from "../../src/property_management/infra/di/property_management_di";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";

function makeExtra(
  headers?: Record<string, string>
): RequestHandlerExtra<ServerRequest, ServerNotification> {
  return {
    signal: new AbortController().signal,
    requestId: "test-request-id",
    requestInfo: headers ? { headers } : undefined,
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

function makeIdentityResolver(): McpIdentityResolver {
  const middlewareDi = new MiddlewareDi();
  return new McpIdentityResolver(
    middlewareDi.makeAuthRepository(),
    middlewareDi.makeSessionManager()
  );
}

function registerListPropertiesTool(): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const propertyManagementDi = new PropertyManagementDi();

  return registerMcpTool(
    server,
    makeIdentityResolver(),
    makeListPropertiesTool(propertyManagementDi)
  );
}

describe("list_properties tool", () => {
  beforeEach(async () => {
    await truncate(["properties", "addresses", "users"]);
  });

  it("returns only the properties administered by the authenticated user", async () => {
    const { user: owner } = await createUserFixture({
      name: "João Silva",
      email: "joao@stayhub.dev",
      password: "password123",
    });
    const { user: otherUser } = await createUserFixture({
      name: "Maria Souza",
      email: "maria@stayhub.dev",
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
    const token = await createAuthToken(owner.id);

    const registeredTool = registerListPropertiesTool();
    const result = await callTool(
      registeredTool,
      {},
      makeExtra({ authorization: `Bearer ${token}` })
    );

    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    const output = JSON.parse(text) as {
      properties: Array<{ id: string; name: string }>;
    };

    expect(output.properties).toEqual([
      { id: ownedProperty.id, name: "Casa da Praia" },
    ]);
  });

  it("rejects a request without an authorization token", async () => {
    const registeredTool = registerListPropertiesTool();

    const result = await callTool(registeredTool, {}, makeExtra());

    expect(result.isError).toBe(true);
  });

  it("rejects a request with an invalid authorization token", async () => {
    const registeredTool = registerListPropertiesTool();

    const result = await callTool(
      registeredTool,
      {},
      makeExtra({ authorization: "Bearer invalid.token.value" })
    );

    expect(result.isError).toBe(true);
  });
});
