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
    const body = (await response.json()) as JsonRpcResponse;

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(body.jsonrpc).toBe("2.0");
    expect(body.error).toEqual({ code: -32000, message: "Unauthorized" });
  });

  it("reaches the transport once an Authorization header is present, even if the token is invalid", async () => {
    const { status, body } = await callMcp(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      },
      "not-a-real-token"
    );

    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
  });

  it("lists the 4 registered tools", async () => {
    const { body } = await callMcp(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      },
      "not-a-real-token"
    );

    const result = body.result as { tools: Array<{ name: string }> };
    const names = result.tools.map(tool => tool.name).sort();

    expect(names).toEqual(
      ["book_stay", "list_properties", "list_stays", "record_expense"].sort()
    );
  });

  it("resolves the caller identity per tool call and returns only their data", async () => {
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

  it("rejects a tool call whose Authorization header carries an invalid token", async () => {
    const { body } = await callMcp(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "list_properties", arguments: {} },
      },
      "not-a-real-token"
    );

    const result = body.result as { isError?: boolean };
    expect(result.isError).toBe(true);
  });
});
