import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createMcpAccessTokenFixture } from "../helpers/fixtures/delegated_access";
import { MCP_RESOURCE_PATH } from "../../src/auth/presentation/controller/delegated_access/oauth_protected_resource_metadata.controller";
import { apiBaseUrl } from "../../src/core/infra/config/environments";
import {
  MAX_BUFFERED_BODY_BYTES,
  MAX_JSON_DEPTH,
} from "../../src/core/infra/http/body/body_limits";
import { makeConnectionSurvivalProbeStream } from "../helpers/paced_stream";

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
};

type OAuthErrorBody = {
  error: string;
  error_description: string;
};

type ToolResultErrorBody = {
  isError: boolean;
  content: Array<{ type: string; text: string }>;
};

/**
 * `/mcp` verifies the access token against this server's canonical resource
 * URL (`apiBaseUrl` + `MCP_RESOURCE_PATH`, task 13) regardless of which port
 * the test HTTP server actually listens on — every credential fixture below
 * has to be issued for this exact audience or the transport gate rejects it
 * with `invalid_token`, indistinguishable from a garbage token.
 */
const MCP_RESOURCE = `${apiBaseUrl}${MCP_RESOURCE_PATH}`;

async function callMcp(
  body: Record<string, unknown>,
  token?: string,
  signal?: AbortSignal
): Promise<{ status: number; body: JsonRpcResponse }> {
  const response = await api("/mcp", {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  const raw = await response.text();
  const dataLine = raw.split("\n").find(line => line.startsWith("data: "));

  if (!dataLine) {
    throw new Error(`No SSE data line in MCP response: ${raw}`);
  }

  return {
    status: response.status,
    body: JSON.parse(dataLine.slice("data: ".length)) as JsonRpcResponse,
  };
}

describe("POST /mcp", () => {
  beforeEach(async () => {
    await truncate([
      "issued_credentials",
      "consents",
      "app_registrations",
      "properties",
      "addresses",
      "users",
    ]);
  });

  it("rejects a request without an Authorization header before reaching the transport", async () => {
    const response = await api("/mcp", {
      method: "POST",
      headers: { Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    const body = (await response.json()) as OAuthErrorBody;
    const wwwAuthenticate = response.headers.get("www-authenticate") ?? "";

    expect(response.status).toBe(401);
    expect(wwwAuthenticate).toContain('Bearer error="invalid_request"');
    expect(wwwAuthenticate).toContain('resource_metadata="http://localhost');
    expect(wwwAuthenticate).toContain("/.well-known/oauth-protected-resource");
    expect(body.error).toBe("invalid_request");
  });

  it("rejects a request whose Authorization header carries an invalid token before reaching the transport", async () => {
    const response = await api("/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer not-a-real-token",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    const body = (await response.json()) as OAuthErrorBody;
    const wwwAuthenticate = response.headers.get("www-authenticate") ?? "";

    expect(response.status).toBe(401);
    expect(wwwAuthenticate).toContain('Bearer error="invalid_token"');
    expect(wwwAuthenticate).toContain("/.well-known/oauth-protected-resource");
    expect(body.error).toBe("invalid_token");
  });

  it("rejects a request whose access token was issued for a different resource", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao.wrong-audience@sogio.dev",
      password: "password123",
    });
    const { accessToken } = await createMcpAccessTokenFixture({
      userId: user.id,
      resource: "https://not-this-server.example.com/mcp",
    });

    const response = await api("/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    const body = (await response.json()) as OAuthErrorBody;

    expect(response.status).toBe(401);
    expect(body.error).toBe("invalid_token");
  });

  it("lists the 37 registered tools", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao.tools-list@sogio.dev",
      password: "password123",
    });
    const { accessToken: token } = await createMcpAccessTokenFixture({
      userId: user.id,
      resource: MCP_RESOURCE,
    });

    const { body } = await callMcp(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      },
      token
    );

    const result = body.result as { tools: Array<{ name: string }> };
    const names = result.tools.map(tool => tool.name).sort();

    expect(names).toEqual(
      [
        "book_stay",
        "cancel_stay",
        "create_property",
        "create_external_booking_source",
        "create_property_setting",
        "delete_ledger_entry",
        "delete_property",
        "delete_property_setting",
        "get_notification_preferences",
        "get_property",
        "get_stay",
        "get_dashboard_overview",
        "get_me",
        "get_property_setting",
        "get_subscription_history",
        "get_subscription_status",
        "get_user_preferences",
        "import_ledger_entries",
        "import_properties",
        "import_stays",
        "list_financial_movements",
        "list_notifications",
        "list_plans",
        "list_properties",
        "list_property_settings",
        "list_stays",
        "list_tenants",
        "mark_all_notifications_read",
        "mark_notification_read",
        "reconcile_external_bookings",
        "record_expense",
        "record_revenue",
        "update_notification_preferences",
        "update_property",
        "update_property_setting",
        "update_stay",
        "update_user_preferences",
      ].sort()
    );
  });

  it("resolves the caller identity once at the transport gate and returns only their data", async () => {
    const { user: owner } = await createUserFixture({
      name: "João Silva",
      email: "joao.mcp@sogio.dev",
      password: "password123",
    });
    const { user: otherUser } = await createUserFixture({
      name: "Maria Souza",
      email: "maria.mcp@sogio.dev",
      password: "password123",
    });
    const ownedProperty = await createPropertyFixture({
      userId: owner.id,
      name: "Casa da Praia",
    });
    await createPropertyFixture({
      userId: otherUser.id,
      name: "Apê do Centro",
    });
    const { accessToken: token } = await createMcpAccessTokenFixture({
      userId: owner.id,
      resource: MCP_RESOURCE,
    });

    const { body } = await callMcp(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "list_properties", arguments: {} },
      },
      token
    );

    const result = body.result as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    const output = JSON.parse(result.content[0]?.text ?? "{}") as {
      properties: Array<{ id: string; name: string }>;
    };

    expect(result.isError).toBeUndefined();
    expect(output.properties).toEqual([
      { id: ownedProperty.id, name: "Casa da Praia" },
    ]);
  });

  it("rejects a request whose body exceeds the buffered body limit with 413, before reaching the transport", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao.oversized-body@sogio.dev",
      password: "password123",
    });
    const { accessToken: token } = await createMcpAccessTokenFixture({
      userId: user.id,
      resource: MCP_RESOURCE,
    });
    const oversizedPadding = "x".repeat(MAX_BUFFERED_BODY_BYTES + 10_000);

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
        params: { padding: oversizedPadding },
      }),
    });
    const body = (await response.json()) as ToolResultErrorBody;

    expect(response.status).toBe(413);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(body.isError).toBe(true);
    expect(body.content[0]?.text).toContain(
      `Request body exceeds the maximum size of ${MAX_BUFFERED_BODY_BYTES} bytes`
    );
  });

  it("serves a real MCP call quickly right after a 413 on the same keep-alive connection", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao.connection-survives-413@sogio.dev",
      password: "password123",
    });
    const { accessToken: token } = await createMcpAccessTokenFixture({
      userId: user.id,
      resource: MCP_RESOURCE,
    });

    const { readable: pacedOversizedBody } = makeConnectionSurvivalProbeStream(
      MAX_BUFFERED_BODY_BYTES + 3 * 1024 * 1024,
      64 * 1024,
      5
    );

    const rejected = await api("/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: pacedOversizedBody,
      duplex: "half",
    } as RequestInit);
    const rejectedBody = (await rejected.json()) as ToolResultErrorBody;

    expect(rejected.status).toBe(413);
    expect(rejectedBody.content[0]?.text).toContain(
      `Request body exceeds the maximum size of ${MAX_BUFFERED_BODY_BYTES} bytes`
    );

    const CONNECTION_SURVIVAL_TIMEOUT_MS = 3_000;
    const start = performance.now();
    const { status, body } = await callMcp(
      {
        jsonrpc: "2.0",
        id: 43,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "sogio-test-client", version: "1.0.0" },
        },
      },
      token,
      AbortSignal.timeout(CONNECTION_SURVIVAL_TIMEOUT_MS)
    );
    const elapsedMs = performance.now() - start;

    expect(status).toBe(200);
    expect(body.id).toBe(43);
    expect(elapsedMs).toBeLessThan(CONNECTION_SURVIVAL_TIMEOUT_MS);
  });

  it("rejects an oversized body with 413 before an invalid token ever gets checked, then serves the next MCP call quickly on the same connection", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao.413-before-401@sogio.dev",
      password: "password123",
    });
    const { accessToken: token } = await createMcpAccessTokenFixture({
      userId: user.id,
      resource: MCP_RESOURCE,
    });
    const oversizedPadding = "x".repeat(MAX_BUFFERED_BODY_BYTES + 10_000);

    const rejected = await api("/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer not-a-real-token",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: { padding: oversizedPadding },
      }),
    });
    const rejectedBody = (await rejected.json()) as ToolResultErrorBody;

    expect(rejected.status).toBe(413);
    expect(rejected.status).not.toBe(401);
    expect(rejectedBody.content[0]?.text).toContain(
      `Request body exceeds the maximum size of ${MAX_BUFFERED_BODY_BYTES} bytes`
    );

    const CONNECTION_SURVIVAL_TIMEOUT_MS = 3_000;
    const start = performance.now();
    const { status, body } = await callMcp(
      {
        jsonrpc: "2.0",
        id: 44,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "sogio-test-client", version: "1.0.0" },
        },
      },
      token,
      AbortSignal.timeout(CONNECTION_SURVIVAL_TIMEOUT_MS)
    );
    const elapsedMs = performance.now() - start;

    expect(status).toBe(200);
    expect(body.id).toBe(44);
    expect(elapsedMs).toBeLessThan(CONNECTION_SURVIVAL_TIMEOUT_MS);
  });

  it("rejects a request nested past the maximum JSON depth with 422, before reaching the transport", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao.excessive-nesting@sogio.dev",
      password: "password123",
    });
    const { accessToken: token } = await createMcpAccessTokenFixture({
      userId: user.id,
      resource: MCP_RESOURCE,
    });
    const nestedDepth = MAX_JSON_DEPTH + 10;
    const deeplyNestedArray = "[".repeat(nestedDepth) + "]".repeat(nestedDepth);
    const rawBody = `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"nested":${deeplyNestedArray}}}`;

    const response = await api("/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: rawBody,
    });
    const body = (await response.json()) as ToolResultErrorBody;
    const rawResponseText = JSON.stringify(body);

    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-type")).not.toContain(
      "text/event-stream"
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(body.isError).toBe(true);
    expect(body.content[0]?.text).toContain(
      `Request body exceeds the maximum nesting depth of ${MAX_JSON_DEPTH}`
    );
    expect(rawResponseText).not.toContain('"jsonrpc"');
  });

  it("processes a real initialize handshake, proving the reconstructed request preserves method, headers and body", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao.initialize@sogio.dev",
      password: "password123",
    });
    const { accessToken: token } = await createMcpAccessTokenFixture({
      userId: user.id,
      resource: MCP_RESOURCE,
    });

    const { status, body } = await callMcp(
      {
        jsonrpc: "2.0",
        id: 42,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "sogio-test-client", version: "1.0.0" },
        },
      },
      token
    );

    const result = body.result as {
      protocolVersion: string;
      serverInfo: { name: string; version: string };
    };

    expect(status).toBe(200);
    expect(body.id).toBe(42);
    expect(result.serverInfo).toEqual({ name: "sogio", version: "1.0.0" });
    expect(result.protocolVersion).toBe("2025-11-25");
  });
});
