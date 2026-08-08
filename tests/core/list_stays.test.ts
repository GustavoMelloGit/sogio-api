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
import { MiddlewareDi } from "../../src/auth/infra/di/middleware";
import { PropertyDi } from "../../src/booking/infra/di/property_di";
import { StayDi } from "../../src/booking/infra/di/stay_di";
import { McpIdentityResolver } from "../../src/core/infra/mcp/identity_resolver";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool";
import { makeListStaysTool } from "../../src/core/infra/mcp/tools/list_stays";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";

const TABLES = ["stays", "tenants", "properties", "addresses", "users"];

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

function registerListStaysTool(): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const stayDi = new StayDi();

  return registerMcpTool(
    server,
    makeIdentityResolver(),
    makeListStaysTool(stayDi)
  );
}

async function bookStayFixture(propertyId: string, user: User) {
  const propertyDi = new PropertyDi();

  return propertyDi.makeBookStayUseCase().execute(
    {
      guests: 2,
      property_id: propertyId,
      check_in: new Date("2040-06-01T12:00:00.000Z"),
      check_out: new Date("2040-06-03T12:00:00.000Z"),
      price: 10000,
      source: "DIRECT",
      tenant: {
        name: "Ana Souza",
        phone: "5511999990001",
        sex: "FEMALE",
      },
    },
    user
  );
}

describe("list_stays tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("returns the stays booked for a property owned by the authenticated user", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@stayhub.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const bookedStay = await bookStayFixture(property.id, user);
    const token = await createAuthToken(user.id);

    const registeredTool = registerListStaysTool();
    const result = await callTool(
      registeredTool,
      { property_id: property.id },
      makeExtra({ authorization: `Bearer ${token}` })
    );

    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    const output = JSON.parse(text) as {
      data: Array<{ id: string; entrance_code?: string }>;
    };

    expect(result.isError).toBeUndefined();
    expect(output.data).toHaveLength(1);
    expect(output.data[0]?.id).toBe(bookedStay.id);
    expect(output.data[0]).not.toHaveProperty("entrance_code");
    expect(bookedStay.entrance_code).toHaveLength(7);
  });

  it("rejects listing stays for a property that belongs to another user", async () => {
    const { user: owner } = await createUserFixture({
      name: "João Silva",
      email: "joao@stayhub.dev",
      password: "password123",
    });
    const { user: intruder } = await createUserFixture({
      name: "Maria Souza",
      email: "maria@stayhub.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: owner.id });
    const token = await createAuthToken(intruder.id);

    const registeredTool = registerListStaysTool();
    const result = await callTool(
      registeredTool,
      { property_id: property.id },
      makeExtra({ authorization: `Bearer ${token}` })
    );

    expect(result.isError).toBe(true);
  });

  it("rejects a request without an authorization token", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@stayhub.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const registeredTool = registerListStaysTool();
    const result = await callTool(
      registeredTool,
      { property_id: property.id },
      makeExtra()
    );

    expect(result.isError).toBe(true);
  });
});
