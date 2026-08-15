import { describe, it, expect, beforeEach } from "bun:test";
import { MiddlewareDi } from "../../src/auth/infra/di/middleware";
import { IssuedCredentialPostgresRepository } from "../../src/auth/infra/database/postgres_repository/delegated_access/issued_credential_postgres_repository";
import { ConsentPostgresRepository } from "../../src/auth/infra/database/postgres_repository/delegated_access/consent_postgres_repository";
import { MCP_RESOURCE_PATH } from "../../src/auth/presentation/controller/delegated_access/oauth_protected_resource_metadata.controller";
import { apiBaseUrl } from "../../src/core/infra/config/environments";
import { McpIdentityResolver } from "../../src/core/infra/mcp/identity_resolver";
import { UnauthorizedError } from "../../src/core/application/error/unauthorized_error";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import {
  createAppRegistrationFixture,
  createConsentFixture,
  issueCredentialFixture,
} from "../helpers/fixtures/delegated_access";

/**
 * `McpIdentityResolver` now verifies the OAuth access token issued by the
 * Auth BC's delegated-access subdomain (task 13) instead of the app's JWT
 * session token — there is no environment carve-out that still accepts a
 * JWT here. Every credential below is therefore minted the way the real
 * `/mcp` gate expects: app registration + consent + issued credential
 * (`tests/helpers/fixtures/delegated_access.ts`), bound to this server's
 * canonical `/mcp` resource URL.
 */
const MCP_RESOURCE = `${apiBaseUrl}${MCP_RESOURCE_PATH}`;

describe("McpIdentityResolver", () => {
  const consentRepository = new ConsentPostgresRepository();
  const issuedCredentialRepository = new IssuedCredentialPostgresRepository();

  beforeEach(async () => {
    await truncate([
      "issued_credentials",
      "consents",
      "app_registrations",
      "users",
    ]);
  });

  function makeResolver(): McpIdentityResolver {
    const middlewareDi = new MiddlewareDi();
    return new McpIdentityResolver(middlewareDi.makeCredentialVerifier());
  }

  it("resolves the requester and touches the consent's last use for a valid access token", async () => {
    const { user } = await createUserFixture({
      name: "Ada Lovelace",
      email: "ada@sogio.dev",
      password: "password123",
    });
    const app = await createAppRegistrationFixture();
    const staleLastUsedAt = new Date(Date.now() - 60_000);
    const consent = await createConsentFixture({
      userId: user.id,
      appRegistrationId: app.id,
      lastUsedAt: staleLastUsedAt,
    });
    const { accessToken } = await issueCredentialFixture({
      consentId: consent.id,
      resource: MCP_RESOURCE,
    });
    const resolver = makeResolver();

    const requester = await resolver.resolveRequester(`Bearer ${accessToken}`);

    expect(requester.user.id).toBe(user.id);
    expect(requester.user.email).toBe(user.email);
    expect(requester.appRegistrationId).toBe(app.id);
    expect(requester.scope).toBe("mcp");

    const touchedConsent = await consentRepository.findById(consent.id);
    expect(touchedConsent?.last_used_at.getTime()).toBeGreaterThan(
      staleLastUsedAt.getTime()
    );
  });

  it("throws UnauthorizedError when the authorization header is missing", async () => {
    const resolver = makeResolver();

    await expect(resolver.resolveRequester(undefined)).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });

  it("throws UnauthorizedError when the authorization header has no token", async () => {
    const resolver = makeResolver();

    await expect(resolver.resolveRequester("Bearer")).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });

  it("throws UnauthorizedError when the access token does not match any issued credential", async () => {
    const resolver = makeResolver();

    await expect(
      resolver.resolveRequester("Bearer not-a-real-access-token")
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws UnauthorizedError when the access token has expired", async () => {
    const { user } = await createUserFixture({
      name: "Grace Hopper",
      email: "grace@sogio.dev",
      password: "password123",
    });
    const app = await createAppRegistrationFixture();
    const consent = await createConsentFixture({
      userId: user.id,
      appRegistrationId: app.id,
    });
    const { accessToken } = await issueCredentialFixture({
      consentId: consent.id,
      resource: MCP_RESOURCE,
      accessTokenExpiresAt: new Date(Date.now() - 1_000),
    });
    const resolver = makeResolver();

    await expect(
      resolver.resolveRequester(`Bearer ${accessToken}`)
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws UnauthorizedError when the credential has been revoked", async () => {
    const { user } = await createUserFixture({
      name: "Katherine Johnson",
      email: "katherine@sogio.dev",
      password: "password123",
    });
    const app = await createAppRegistrationFixture();
    const consent = await createConsentFixture({
      userId: user.id,
      appRegistrationId: app.id,
    });
    const { issuedCredential, accessToken } = await issueCredentialFixture({
      consentId: consent.id,
      resource: MCP_RESOURCE,
    });
    await issuedCredentialRepository.revokeById(issuedCredential.id);
    const resolver = makeResolver();

    await expect(
      resolver.resolveRequester(`Bearer ${accessToken}`)
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws UnauthorizedError when the credential was issued for a different audience", async () => {
    const { user } = await createUserFixture({
      name: "Margaret Hamilton",
      email: "margaret@sogio.dev",
      password: "password123",
    });
    const app = await createAppRegistrationFixture();
    const consent = await createConsentFixture({
      userId: user.id,
      appRegistrationId: app.id,
    });
    const { accessToken } = await issueCredentialFixture({
      consentId: consent.id,
      resource: "https://not-this-server.example.com/mcp",
    });
    const resolver = makeResolver();

    await expect(
      resolver.resolveRequester(`Bearer ${accessToken}`)
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
