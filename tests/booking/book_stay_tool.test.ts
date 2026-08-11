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
import { db } from "../../src/core/infra/database/drizzle/database";
import { staysTable } from "../../src/core/infra/database/drizzle/schema";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool";
import {
  inputSchema,
  makeBookStayTool,
} from "../../src/core/infra/mcp/tools/book_stay";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";

const TABLES = ["stays", "tenants", "properties", "addresses", "users"];

/**
 * Shape a caller would send over the wire (ISO-8601 strings), used to
 * exercise the tool's Zod schema directly via `safeParse`.
 */
const rawValidInput = {
  property_id: "",
  guests: 2,
  check_in: "2040-06-01T12:00:00-03:00",
  check_out: "2040-06-03T12:00:00-03:00",
  price: 10000,
  source: "DIRECT",
  tenant: {
    name: "Ana Souza",
    phone: "5511999990001",
    sex: "FEMALE",
  },
};

/**
 * Shape the SDK would hand to the handler *after* running the tool's Zod
 * schema (which transforms check_in/check_out into `Date`). `callTool`
 * below invokes the raw handler directly, skipping that transport-level
 * validation/transform step, so tests exercising the handler must already
 * provide `Date` instances here.
 */
const handlerValidInput = {
  ...rawValidInput,
  check_in: new Date(rawValidInput.check_in),
  check_out: new Date(rawValidInput.check_out),
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

/**
 * Identity resolution now happens once, at the `/mcp` transport gate
 * (`routes.ts`), before a tool is ever registered — see `mcp_tool.ts`. Tools
 * are registered bound to the already-resolved `user`, so these tests
 * simulate that by passing the fixture user straight into `registerMcpTool`.
 */
function registerBookStayTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const propertyDi = new PropertyDi();

  return registerMcpTool(server, user, makeBookStayTool(propertyDi));
}

describe("book_stay tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("books a stay and lets the use case generate the entrance_code automatically", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@stayhub.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const registeredTool = registerBookStayTool(user);
    const result = await callTool(
      registeredTool,
      { ...handlerValidInput, property_id: property.id },
      makeExtra()
    );

    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    const output = JSON.parse(text) as {
      id: string;
      entrance_code?: string;
      tenant_id: string;
    };

    expect(result.isError).toBeUndefined();
    expect(output).not.toHaveProperty("entrance_code");

    const rows = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.id, output.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.entrance_code).toHaveLength(7);
  });

  it("ignores an entrance_code sent by the caller instead of forwarding it to the use case", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@stayhub.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const registeredTool = registerBookStayTool(user);
    const result = await callTool(
      registeredTool,
      {
        ...handlerValidInput,
        property_id: property.id,
        entrance_code: "9999999",
      },
      makeExtra()
    );

    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    const output = JSON.parse(text) as { id: string; entrance_code?: string };

    expect(result.isError).toBeUndefined();
    expect(output).not.toHaveProperty("entrance_code");

    const rows = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.id, output.id));

    expect(rows[0]?.entrance_code).not.toBe("9999999");
    expect(rows[0]?.entrance_code).toHaveLength(7);
  });

  it("strips entrance_code from the tool's Zod input schema (unknown keys are dropped, not rejected)", () => {
    const parsed = z.object(inputSchema).safeParse({
      ...rawValidInput,
      property_id: crypto.randomUUID(),
      entrance_code: "1234567",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && "entrance_code" in parsed.data).toBe(false);
  });

  it("requires an explicit UTC offset on check_in/check_out, rejecting bare dates and offset-less datetimes", () => {
    const bareDate = z.object(inputSchema).safeParse({
      ...rawValidInput,
      property_id: crypto.randomUUID(),
      check_in: "2040-06-01",
    });
    const offsetLess = z.object(inputSchema).safeParse({
      ...rawValidInput,
      property_id: crypto.randomUUID(),
      check_out: "2040-06-03T12:00:00",
    });
    const withOffset = z.object(inputSchema).safeParse({
      ...rawValidInput,
      property_id: crypto.randomUUID(),
    });

    expect(bareDate.success).toBe(false);
    expect(offsetLess.success).toBe(false);
    expect(withOffset.success).toBe(true);
  });

  it("rejects booking a property that belongs to another user", async () => {
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

    const registeredTool = registerBookStayTool(intruder);
    const result = await callTool(
      registeredTool,
      { ...handlerValidInput, property_id: property.id },
      makeExtra()
    );

    expect(result.isError).toBe(true);

    const rows = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.property_id, property.id));

    expect(rows).toHaveLength(0);
  });

  it("rejects overlapping dates for a stay already booked on the same property", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@stayhub.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const registeredTool = registerBookStayTool(user);
    const firstResult = await callTool(
      registeredTool,
      { ...handlerValidInput, property_id: property.id },
      makeExtra()
    );

    expect(firstResult.isError).toBeUndefined();

    const secondResult = await callTool(
      registeredTool,
      {
        ...handlerValidInput,
        property_id: property.id,
        check_in: new Date("2040-06-02T12:00:00-03:00"),
        check_out: new Date("2040-06-04T12:00:00-03:00"),
      },
      makeExtra()
    );

    expect(secondResult.isError).toBe(true);

    const rows = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.property_id, property.id));

    expect(rows).toHaveLength(1);
  });
});
