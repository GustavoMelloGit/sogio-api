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
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";

const TABLES = ["stays", "tenants", "properties", "addresses", "users"];

type StayPayload = {
  id: string;
  entrance_code?: string;
  price: number;
  tenant: { name: string; phone: string };
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

function payloadOf(result: CallToolResult): StayPayload {
  const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
  return JSON.parse(text) as StayPayload;
}

function registerGetStayTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const stayDi = new StayDi();

  return registerMcpTool(
    server,
    user,
    CapabilitySet.of({}),
    stayDi.makeGetStayTool()
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

describe("get_stay tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("returns one stay in full, entrance code included", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const bookedStay = await bookStayFixture(property.id, user);

    const registeredTool = registerGetStayTool(user);
    const result = await callTool(
      registeredTool,
      { stay_id: bookedStay.id },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();

    const output = payloadOf(result);
    expect(output.id).toBe(bookedStay.id);
    expect(output.entrance_code).toBe(bookedStay.entrance_code);
    expect(output.tenant.name).toBe("Ana Souza");
  });

  it("rejects reading a stay of a property that belongs to another user", async () => {
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
    const bookedStay = await bookStayFixture(property.id, owner);

    const registeredTool = registerGetStayTool(intruder);
    const result = await callTool(
      registeredTool,
      { stay_id: bookedStay.id },
      makeExtra()
    );

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]?.text).not.toContain(
      bookedStay.entrance_code
    );
  });

  it("reports an unknown stay as not found", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });

    const registeredTool = registerGetStayTool(user);
    const result = await callTool(
      registeredTool,
      { stay_id: crypto.randomUUID() },
      makeExtra()
    );

    expect(result.isError).toBe(true);
  });
});
