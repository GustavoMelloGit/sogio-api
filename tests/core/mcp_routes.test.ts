import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";

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
    await truncate(["properties", "addresses", "users"]);
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

  it("lists the 4 registered tools", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao.tools-list@stayhub.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);

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
      ["book_stay", "list_properties", "list_stays", "record_expense"].sort()
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
    const token = await createAuthToken(owner.id);

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
