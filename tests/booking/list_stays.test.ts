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
import { StayDi } from "../../src/booking/infra/di/stay_di";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";

const TABLES = ["stays", "tenants", "properties", "addresses", "users"];

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
function registerListStaysTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const stayDi = new StayDi();

  return registerMcpTool(server, user, stayDi.makeListStaysTool());
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
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const bookedStay = await bookStayFixture(property.id, user);

    const registeredTool = registerListStaysTool(user);
    const result = await callTool(
      registeredTool,
      { property_id: property.id },
      makeExtra()
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
      email: "joao@sogio.dev",
      password: "password123",
    });
    const { user: intruder } = await createUserFixture({
      name: "Maria Souza",
      email: "maria@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: owner.id });

    const registeredTool = registerListStaysTool(intruder);
    const result = await callTool(
      registeredTool,
      { property_id: property.id },
      makeExtra()
    );

    expect(result.isError).toBe(true);
  });
});
