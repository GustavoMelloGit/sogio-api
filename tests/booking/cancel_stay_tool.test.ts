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
import { PropertyDi } from "../../src/booking/infra/di/property_di";
import { StayDi } from "../../src/booking/infra/di/stay_di";
import { db } from "../../src/core/infra/database/drizzle/database";
import { staysTable } from "../../src/core/infra/database/drizzle/schema";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool";
import { makeCancelStayTool } from "../../src/core/infra/mcp/tools/cancel_stay";
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
function registerCancelStayTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });

  return registerMcpTool(server, user, makeCancelStayTool(new StayDi()));
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

describe("cancel_stay tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("cancels a stay owned by the authenticated user and reverses its revenue", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const bookedStay = await bookStayFixture(property.id, user);

    const registeredTool = registerCancelStayTool(user);
    const result = await callTool(
      registeredTool,
      { stay_id: bookedStay.id },
      makeExtra()
    );

    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    const output = JSON.parse(text) as {
      id: string;
      cancelled_at: string;
    };

    expect(result.isError).toBeUndefined();
    expect(output.id).toBe(bookedStay.id);
    expect(output.cancelled_at).toBeDefined();
    expect(Object.keys(output).sort()).toEqual(["cancelled_at", "id"]);

    const rows = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.id, output.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.deleted_at).not.toBeNull();
  });

  it("does not distinguish another owner's stay from a nonexistent one", async () => {
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

    const registeredTool = registerCancelStayTool(intruder);

    const resultForAnotherOwnersStay = await callTool(
      registeredTool,
      { stay_id: bookedStay.id },
      makeExtra()
    );
    const resultForNonexistentStay = await callTool(
      registeredTool,
      { stay_id: crypto.randomUUID() },
      makeExtra()
    );

    expect(resultForAnotherOwnersStay.isError).toBe(true);
    expect(resultForNonexistentStay.isError).toBe(true);

    const textForAnotherOwnersStay =
      (resultForAnotherOwnersStay.content as Array<{ text: string }>)[0]
        ?.text ?? "";
    const textForNonexistentStay =
      (resultForNonexistentStay.content as Array<{ text: string }>)[0]?.text ??
      "";

    expect(textForAnotherOwnersStay).toBe(textForNonexistentStay);

    const rows = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.id, bookedStay.id));

    expect(rows[0]?.deleted_at).toBeNull();
  });
});
