import { describe, it, expect } from "bun:test";
import { api } from "../helpers/server";
import { apiBaseUrl } from "../../src/core/infra/config/environments";

type ProtectedResourceMetadata = {
  resource: string;
  authorization_servers: string[];
};

type AuthorizationServerMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  revocation_endpoint: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
};

describe("GET /.well-known/oauth-protected-resource", () => {
  it("returns the resource server metadata with resource derived from API_BASE_URL", async () => {
    const response = await api("/.well-known/oauth-protected-resource");
    const body = (await response.json()) as ProtectedResourceMetadata;

    expect(response.status).toBe(200);
    expect(body.resource).toBe(`${apiBaseUrl}/mcp`);
    expect(body.authorization_servers).toEqual([apiBaseUrl]);
  });

  it("is cacheable", async () => {
    const response = await api("/.well-known/oauth-protected-resource");

    expect(response.headers.get("Cache-Control")).toContain("public");
    expect(response.headers.get("Cache-Control")).toContain("max-age=");
  });

  it("responds with public CORS, no credentials, to any origin", async () => {
    const response = await api("/.well-known/oauth-protected-resource", {
      headers: { Origin: "https://an-arbitrary-mcp-client.example" },
    });

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});

describe("GET /.well-known/oauth-protected-resource/mcp", () => {
  it("returns the same metadata as the canonical path (RFC 9728 §3.1 resource-path variant)", async () => {
    const response = await api("/.well-known/oauth-protected-resource/mcp");
    const body = (await response.json()) as ProtectedResourceMetadata;

    expect(response.status).toBe(200);
    expect(body.resource).toBe(`${apiBaseUrl}/mcp`);
    expect(body.authorization_servers).toEqual([apiBaseUrl]);
  });

  it("is cacheable and public-CORS, same as the canonical path", async () => {
    const response = await api("/.well-known/oauth-protected-resource/mcp", {
      headers: { Origin: "https://an-arbitrary-mcp-client.example" },
    });

    expect(response.headers.get("Cache-Control")).toContain("public");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});

describe("GET /.well-known/oauth-authorization-server", () => {
  it("returns the authorization server metadata with issuer identical to API_BASE_URL", async () => {
    const response = await api("/.well-known/oauth-authorization-server");
    const body = (await response.json()) as AuthorizationServerMetadata;

    expect(response.status).toBe(200);
    expect(body.issuer).toBe(apiBaseUrl);
    expect(body.authorization_endpoint).toBe(`${apiBaseUrl}/authorize`);
    expect(body.token_endpoint).toBe(`${apiBaseUrl}/token`);
    expect(body.registration_endpoint).toBe(`${apiBaseUrl}/register`);
    expect(body.revocation_endpoint).toBe(`${apiBaseUrl}/revoke`);
    expect(body.response_types_supported).toEqual(["code"]);
    expect(body.grant_types_supported).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
    expect(body.code_challenge_methods_supported).toEqual(["S256"]);
    expect(body.token_endpoint_auth_methods_supported).toEqual(["none"]);
  });

  it("does not advertise any RFC 7592 client configuration management endpoint", async () => {
    const response = await api("/.well-known/oauth-authorization-server");
    const body = (await response.json()) as Record<string, unknown>;

    expect(Object.keys(body)).not.toContain("registration_client_uri_endpoint");
    expect(JSON.stringify(body)).not.toContain("registration_access_token");
  });

  it("is cacheable", async () => {
    const response = await api("/.well-known/oauth-authorization-server");

    expect(response.headers.get("Cache-Control")).toContain("public");
    expect(response.headers.get("Cache-Control")).toContain("max-age=");
  });

  it("responds with public CORS, no credentials, to any origin", async () => {
    const response = await api("/.well-known/oauth-authorization-server", {
      headers: { Origin: "https://an-arbitrary-mcp-client.example" },
    });

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});
