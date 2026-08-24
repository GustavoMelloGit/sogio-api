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
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";

const TABLES = ["properties", "addresses", "users"];

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

function registerReconcileExternalBookingsTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const propertyDi = new PropertyDi();

  return registerMcpTool(
    server,
    user,
    CapabilitySet.of({}),
    propertyDi.makeReconcileExternalBookingsTool()
  );
}

describe("reconcile_external_bookings tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("returns an empty array when the user has no properties", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });

    const registeredTool = registerReconcileExternalBookingsTool(user);
    const result = await callTool(registeredTool, {}, makeExtra());

    expect(result.isError).toBeUndefined();

    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    const payload = JSON.parse(text) as unknown[];

    expect(payload).toEqual([]);
  });

  it("returns an empty array when the user's property has no connected external calendars", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    await createPropertyFixture({ userId: user.id });

    const registeredTool = registerReconcileExternalBookingsTool(user);
    const result = await callTool(registeredTool, {}, makeExtra());

    expect(result.isError).toBeUndefined();

    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    const payload = JSON.parse(text) as unknown[];

    expect(payload).toEqual([]);
  });
});
