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
import { z } from "zod";
import type { User } from "../../src/auth/domain/entity/user";
import { PropertyDi } from "../../src/booking/infra/di/property_di";
import { StayDi } from "../../src/booking/infra/di/stay_di";
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";
import { db } from "../../src/core/infra/database/drizzle/database";
import { staysTable } from "../../src/core/infra/database/drizzle/schema";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { inputSchema } from "../../src/booking/presentation/mcp_tool/update_stay.mcp_tool";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";

const TABLES = ["stays", "tenants", "properties", "addresses", "users"];

type UpdatedStayPayload = {
  id: string;
  price: number;
  guests: number;
  entrance_code?: string;
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

function asToolArguments(
  raw: Record<string, unknown>
): Record<string, unknown> {
  return z.object(inputSchema).parse(raw);
}

function payloadOf(result: CallToolResult): UpdatedStayPayload {
  const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
  return JSON.parse(text) as UpdatedStayPayload;
}

function registerUpdateStayTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const stayDi = new StayDi();

  return registerMcpTool(
    server,
    user,
    CapabilitySet.of({}),
    stayDi.makeUpdateStayTool()
  );
}

async function bookStayFixture(
  propertyId: string,
  user: User,
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
      tenant: {
        name: "Ana Souza",
        phone: "5511999990001",
        sex: "FEMALE",
      },
    },
    user
  );
}

describe("update_stay tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("changes only the fields it is given", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const bookedStay = await bookStayFixture(property.id, user);

    const registeredTool = registerUpdateStayTool(user);
    const result = await callTool(
      registeredTool,
      asToolArguments({ stay_id: bookedStay.id, price: 55000 }),
      makeExtra()
    );

    expect(result.isError).toBeUndefined();

    const output = payloadOf(result);
    expect(output.price).toBe(55000);
    expect(output.guests).toBe(2);

    const rows = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.id, bookedStay.id));

    expect(rows[0]?.price).toBe(55000);
    expect(rows[0]?.check_in).toEqual(new Date("2040-06-01T12:00:00.000Z"));
  });

  it("never returns the entrance code", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const bookedStay = await bookStayFixture(property.id, user);

    const registeredTool = registerUpdateStayTool(user);
    const result = await callTool(
      registeredTool,
      asToolArguments({ stay_id: bookedStay.id, price: 55000 }),
      makeExtra()
    );

    expect(payloadOf(result)).not.toHaveProperty("entrance_code");
    expect((result.content as Array<{ text: string }>)[0]?.text).not.toContain(
      bookedStay.entrance_code
    );
  });

  it("rejects new dates that overlap another stay of the same property", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const firstStay = await bookStayFixture(property.id, user);
    await bookStayFixture(
      property.id,
      user,
      "2040-07-01T12:00:00.000Z",
      "2040-07-05T12:00:00.000Z"
    );

    const registeredTool = registerUpdateStayTool(user);
    const result = await callTool(
      registeredTool,
      asToolArguments({
        stay_id: firstStay.id,
        check_in: "2040-07-02T14:00:00.000Z",
        check_out: "2040-07-04T11:00:00.000Z",
      }),
      makeExtra()
    );

    expect(result.isError).toBe(true);

    const rows = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.id, firstStay.id));

    expect(rows[0]?.check_in).toEqual(new Date("2040-06-01T12:00:00.000Z"));
  });

  it("rejects updating a stay of a property that belongs to another user", async () => {
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

    const registeredTool = registerUpdateStayTool(intruder);
    const result = await callTool(
      registeredTool,
      asToolArguments({ stay_id: bookedStay.id, price: 55000 }),
      makeExtra()
    );

    expect(result.isError).toBe(true);

    const rows = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.id, bookedStay.id));

    expect(rows[0]?.price).toBe(10000);
  });
});
