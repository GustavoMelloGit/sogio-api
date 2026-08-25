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
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import type { User } from "../../src/auth/domain/entity/user";
import { MCP_RESOURCE_PATH } from "../../src/auth/presentation/controller/delegated_access/oauth_protected_resource_metadata.controller";
import type { EntitlementService } from "../../src/billing/application/service/entitlement_service";
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";
import { Entitlement } from "../../src/billing/domain/value_object/entitlement";
import { apiBaseUrl } from "../../src/core/infra/config/environments";
import { BunHttpControllerAdapter } from "../../src/core/infra/http/adapters/http_controller_adapter";
import { CoreDi } from "../../src/core/infra/di/core_di";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { InMemoryRateLimiter } from "../../src/core/infra/rate_limit/in_memory_rate_limiter";
import type { RateLimitPolicy } from "../../src/core/application/rate_limit/rate_limit_policy";
import {
  HttpControllerMethod,
  type Controller,
} from "../../src/core/presentation/controller/controller";
import { truncate } from "../helpers/database";
import { createMcpAccessTokenFixture } from "../helpers/fixtures/delegated_access";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { createUserFixture } from "../helpers/fixtures/user";
import { api } from "../helpers/server";

const MCP_RESOURCE = `${apiBaseUrl}${MCP_RESOURCE_PATH}`;

const TABLES = ["issued_credentials", "consents", "app_registrations", "users"];

const permissiveEntitlementService: EntitlementService = {
  entitlementOf: async () =>
    Entitlement.of({
      has_platform_access: true,
      status: "active",
      capabilities: CapabilitySet.of({}),
      plan: null,
    }),
};

class FakeUserRateLimitedController implements Controller {
  path: string;
  method = HttpControllerMethod.GET;
  userRateLimitPolicy: RateLimitPolicy;

  constructor(path: string, policy: RateLimitPolicy) {
    this.path = path;
    this.userRateLimitPolicy = policy;
  }

  async handle() {
    return { ok: true };
  }
}

const userLimitedController = new FakeUserRateLimitedController(
  "/__test/user-rate-limit/limited",
  { keyDimension: "user", windowMs: 60_000, maxAttempts: 1 }
);

const httpServer = Bun.serve({
  port: 0,
  routes: {
    [userLimitedController.path]: {
      [HttpControllerMethod.GET]: BunHttpControllerAdapter(
        userLimitedController,
        true,
        permissiveEntitlementService
      ),
    },
  },
});

const httpBaseUrl = `http://localhost:${httpServer.port}`;

afterAll(() => {
  httpServer.stop();
});

describe("userRateLimitPolicy through BunHttpControllerAdapter", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("returns 429 after the declared limit is exceeded by the same user", async () => {
    const { user } = await createUserFixture({
      name: "Usuário Único",
      email: "user-rate-limit.single@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);

    const first = await fetch(`${httpBaseUrl}${userLimitedController.path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const second = await fetch(`${httpBaseUrl}${userLimitedController.path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    const body = (await second.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: "rate_limited" });
  });

  it("does not share the quota between two different users", async () => {
    const { user: userA } = await createUserFixture({
      name: "Usuário A",
      email: "user-rate-limit.a@sogio.dev",
      password: "password123",
    });
    const { user: userB } = await createUserFixture({
      name: "Usuário B",
      email: "user-rate-limit.b@sogio.dev",
      password: "password123",
    });
    const tokenA = await createAuthToken(userA.id);
    const tokenB = await createAuthToken(userB.id);

    const firstA = await fetch(`${httpBaseUrl}${userLimitedController.path}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const firstB = await fetch(`${httpBaseUrl}${userLimitedController.path}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });

    expect(firstA.status).toBe(200);
    expect(firstB.status).toBe(200);
  });

  it("keeps sharing the same quota for one user regardless of the claimed peer IP", async () => {
    const { user } = await createUserFixture({
      name: "Usuário Multi-IP",
      email: "user-rate-limit.multi-ip@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);

    const first = await fetch(`${httpBaseUrl}${userLimitedController.path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Forwarded-For": "203.0.113.1",
      },
    });
    const second = await fetch(`${httpBaseUrl}${userLimitedController.path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Forwarded-For": "198.51.100.7",
      },
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });
});

describe("BunHttpControllerAdapter — userRateLimitPolicy configuration guard", () => {
  it("throws at construction when userRateLimitPolicy is declared on a route that is neither authenticated nor adminOnly", () => {
    const controller = new FakeUserRateLimitedController(
      "/__test/user-rate-limit/misconfigured-unauthenticated",
      { keyDimension: "user", windowMs: 60_000, maxAttempts: 1 }
    );

    expect(() =>
      BunHttpControllerAdapter(controller, false, permissiveEntitlementService)
    ).toThrow();
  });

  it("does not throw when userRateLimitPolicy is declared on an authenticated, non-admin route", () => {
    const controller = new FakeUserRateLimitedController(
      "/__test/user-rate-limit/misconfigured-control",
      { keyDimension: "user", windowMs: 60_000, maxAttempts: 1 }
    );

    expect(() =>
      BunHttpControllerAdapter(controller, true, permissiveEntitlementService)
    ).not.toThrow();
  });

  it("does not throw when userRateLimitPolicy is declared on an adminOnly route", () => {
    const controller = new FakeUserRateLimitedController(
      "/__test/user-rate-limit/admin-only",
      { keyDimension: "user", windowMs: 60_000, maxAttempts: 1 }
    );

    expect(() =>
      BunHttpControllerAdapter(
        controller,
        false,
        permissiveEntitlementService,
        true
      )
    ).not.toThrow();
  });
});

describe("/mcp transport-level per-user rate limit", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("returns 429 once a user exceeds the transport-level limit", async () => {
    const { user } = await createUserFixture({
      name: "Usuário MCP Transporte",
      email: "user-rate-limit.mcp-transport@sogio.dev",
      password: "password123",
    });
    const { accessToken: token } = await createMcpAccessTokenFixture({
      userId: user.id,
      resource: MCP_RESOURCE,
    });

    const rateLimiter = new CoreDi().makeRateLimiter();
    const transportPolicy: RateLimitPolicy = {
      keyDimension: "user",
      windowMs: 60 * 1000,
      maxAttempts: 300,
    };
    for (let i = 0; i < 300; i++) {
      rateLimiter.consume(`mcp:${user.id}`, transportPolicy);
    }

    const response = await api("/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    const body = (await response.json()) as {
      isError: boolean;
      content: Array<{ type: string; text: string }>;
    };

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(body.isError).toBe(true);
    expect(body.content[0]?.text).not.toBe("Internal server error");
  });
});

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

const fakeUser = {
  id: "user-tool-rate-limit-1",
  email: "ada@sogio.dev",
} as User;

describe("registerMcpTool — rateLimitPolicy", () => {
  it("returns a tool error whose text is not 'Internal server error' once the tool's own policy is exceeded", async () => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" });
    const limiter = new InMemoryRateLimiter();

    const registeredTool = registerMcpTool(
      server,
      fakeUser,
      CapabilitySet.of({}),
      {
        name: "rate_limited_tool",
        description: "A tool with a tight per-user rate limit",
        inputSchema: {},
        rateLimitPolicy: {
          keyDimension: "user",
          windowMs: 60_000,
          maxAttempts: 1,
        },
        handler: async () => ({ ok: true }),
      },
      limiter
    );

    const first = await callTool(registeredTool, {}, makeExtra());
    const second = await callTool(registeredTool, {}, makeExtra());

    expect(first.isError).toBeUndefined();
    expect(second.isError).toBe(true);
    const text = (second.content as Array<{ text: string }>)[0]?.text;
    expect(text).not.toBe("Internal server error");
  });

  it("does not share the quota between two different users calling the same tool", async () => {
    const limiter = new InMemoryRateLimiter();
    const userA = {
      id: "user-tool-rate-limit-a",
      email: "a@sogio.dev",
    } as User;
    const userB = {
      id: "user-tool-rate-limit-b",
      email: "b@sogio.dev",
    } as User;

    const toolDefinition = {
      name: "shared_rate_limited_tool",
      description: "A tool with a tight per-user rate limit",
      inputSchema: {},
      rateLimitPolicy: {
        keyDimension: "user" as const,
        windowMs: 60_000,
        maxAttempts: 1,
      },
      handler: async () => ({ ok: true }),
    };

    const toolForA = registerMcpTool(
      new McpServer({ name: "test-server-a", version: "1.0.0" }),
      userA,
      CapabilitySet.of({}),
      toolDefinition,
      limiter
    );
    const toolForB = registerMcpTool(
      new McpServer({ name: "test-server-b", version: "1.0.0" }),
      userB,
      CapabilitySet.of({}),
      toolDefinition,
      limiter
    );

    const resultA = await callTool(toolForA, {}, makeExtra());
    const resultB = await callTool(toolForB, {}, makeExtra());

    expect(resultA.isError).toBeUndefined();
    expect(resultB.isError).toBeUndefined();
  });
});
