import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createMcpAccessTokenFixture } from "../helpers/fixtures/delegated_access";
import { MCP_RESOURCE_PATH } from "../../src/auth/presentation/controller/delegated_access/oauth_protected_resource_metadata.controller";
import { apiBaseUrl } from "../../src/core/infra/config/environments";

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
  token?: string
): Promise<{ status: number; body: JsonRpcResponse }> {
  const response = await api("/mcp", {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
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
      email: "joao.wrong-audience@stayhub.dev",
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

  it("lists the 10 registered tools", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao.tools-list@stayhub.dev",
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
        "create_property_setting",
        "delete_property_setting",
        "get_property_setting",
        "list_properties",
        "list_property_settings",
        "list_stays",
        "record_expense",
        "update_property_setting",
      ].sort()
    );
  });

  it("resolves the caller identity once at the transport gate and returns only their data", async () => {
    const { user: owner } = await createUserFixture({
      name: "João Silva",
      email: "joao.mcp@stayhub.dev",
      password: "password123",
    });
    const { user: otherUser } = await createUserFixture({
      name: "Maria Souza",
      email: "maria.mcp@stayhub.dev",
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
});
