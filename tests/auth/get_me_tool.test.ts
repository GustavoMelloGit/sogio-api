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
import { AuthDi } from "../../src/auth/infra/di/auth_di";
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";

const TABLES = ["users"];

type MePayload = {
  id: string;
  name: string;
  email: string;
  locale: string;
  time_zone: string;
  created_at: string;
  updated_at: string;
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

function registerGetMeTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const authDi = new AuthDi();

  return registerMcpTool(
    server,
    user,
    CapabilitySet.of({}),
    authDi.makeGetMeTool()
  );
}

describe("get_me tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("returns the authenticated user's own profile", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });

    const registeredTool = registerGetMeTool(user);
    const result = await callTool(registeredTool, {}, makeExtra());

    expect(result.isError).toBeUndefined();

    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    const payload = JSON.parse(text) as MePayload;

    expect(payload).toEqual({
      id: user.id,
      name: "João Silva",
      email: "joao@sogio.dev",
      locale: "pt-BR",
      time_zone: "America/Sao_Paulo",
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
  });

  it("never exposes the password hash", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });

    const registeredTool = registerGetMeTool(user);
    const result = await callTool(registeredTool, {}, makeExtra());

    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    const payload = JSON.parse(text) as Record<string, unknown>;

    expect(payload).not.toHaveProperty("password");
  });

  it("scopes the response to whichever user the tool was registered for", async () => {
    const { user: userA } = await createUserFixture({
      name: "Conta A",
      email: "conta-a@sogio.dev",
      password: "password123",
    });
    const { user: userB } = await createUserFixture({
      name: "Conta B",
      email: "conta-b@sogio.dev",
      password: "password123",
    });

    const resultA = await callTool(registerGetMeTool(userA), {}, makeExtra());
    const resultB = await callTool(registerGetMeTool(userB), {}, makeExtra());

    const textA = (resultA.content as Array<{ text: string }>)[0]?.text ?? "";
    const textB = (resultB.content as Array<{ text: string }>)[0]?.text ?? "";
    const payloadA = JSON.parse(textA) as MePayload;
    const payloadB = JSON.parse(textB) as MePayload;

    expect(payloadA.id).toBe(userA.id);
    expect(payloadA.email).toBe("conta-a@sogio.dev");
    expect(payloadB.id).toBe(userB.id);
    expect(payloadB.email).toBe("conta-b@sogio.dev");
  });
});
