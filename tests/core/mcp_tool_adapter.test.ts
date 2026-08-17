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
import { describe, expect, it } from "bun:test";
import { formatISO } from "date-fns";
import { z } from "zod";
import type { User } from "../../src/auth/domain/entity/user";
import { ValidationError } from "../../src/core/application/error/validation_error";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";

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

const fakeUser = { id: "user-1", email: "ada@sogio.dev" } as User;

/**
 * Identity resolution no longer happens inside `registerMcpTool` — it
 * happens once at the `/mcp` transport gate in `routes.ts`, and the already
 * resolved `User` is passed in here. These tests exercise what
 * `registerMcpTool` still owns: forwarding input and the bound `user` to the
 * handler, serializing the output, and mapping errors thrown by the handler.
 */
describe("registerMcpTool", () => {
  it("forwards the input and the already-resolved user to the handler", async () => {
    let receivedInput: unknown;
    let receivedUser: User | undefined;
    const server = new McpServer({ name: "test-server", version: "1.0.0" });

    const registeredTool = registerMcpTool(server, fakeUser, {
      name: "echo",
      description: "Echoes the input back",
      inputSchema: { message: z.string() },
      handler: async (input, user) => {
        receivedInput = input;
        receivedUser = user;
        return { echoed: input.message };
      },
    });

    const result = await callTool(
      registeredTool,
      { message: "hello" },
      makeExtra()
    );

    expect(receivedInput).toEqual({ message: "hello" });
    expect(receivedUser).toBe(fakeUser);
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify({ echoed: "hello" }) }],
    });
  });

  it("serializes dates in the handler output to ISO strings", async () => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" });
    const bookedAt = new Date("2026-08-07T12:00:00.000Z");

    const registeredTool = registerMcpTool(server, fakeUser, {
      name: "book",
      description: "Books something",
      inputSchema: {},
      handler: async () => ({ bookedAt }),
    });

    const result = await callTool(registeredTool, {}, makeExtra());

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({ bookedAt: formatISO(bookedAt) }),
        },
      ],
    });
  });

  it("maps a domain error thrown by the handler to a tool error with the domain message", async () => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" });

    const registeredTool = registerMcpTool(server, fakeUser, {
      name: "fail",
      description: "Always fails validation",
      inputSchema: {},
      handler: async () => {
        throw new ValidationError("category must be one of the allowed values");
      },
    });

    const result = await callTool(registeredTool, {}, makeExtra());

    expect(result).toEqual({
      isError: true,
      content: [
        { type: "text", text: "category must be one of the allowed values" },
      ],
    });
  });

  it("masks unexpected errors with a generic message", async () => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" });

    const registeredTool = registerMcpTool(server, fakeUser, {
      name: "explode",
      description: "Throws an unexpected error",
      inputSchema: {},
      handler: async () => {
        throw new Error("leaked internal detail");
      },
    });

    const result = await callTool(registeredTool, {}, makeExtra());

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Internal server error" }],
    });
  });
});
