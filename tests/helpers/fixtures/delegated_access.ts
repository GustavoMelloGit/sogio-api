import { AppRegistration } from "../../../src/auth/domain/entity/delegated_access/app_registration";
import { AppRegistrationPostgresRepository } from "../../../src/auth/infra/database/postgres_repository/delegated_access/app_registration_postgres_repository";
import { Consent } from "../../../src/auth/domain/entity/delegated_access/consent";
import { ConsentPostgresRepository } from "../../../src/auth/infra/database/postgres_repository/delegated_access/consent_postgres_repository";
import { AuthorizationCode } from "../../../src/auth/domain/entity/delegated_access/authorization_code";
import { AuthorizationCodePostgresRepository } from "../../../src/auth/infra/database/postgres_repository/delegated_access/authorization_code_postgres_repository";
import { AuthorizationRequest } from "../../../src/auth/domain/entity/delegated_access/authorization_request";
import { AuthorizationRequestPostgresRepository } from "../../../src/auth/infra/database/postgres_repository/delegated_access/authorization_request_postgres_repository";
import { IssuedCredential } from "../../../src/auth/domain/entity/delegated_access/issued_credential";
import { IssuedCredentialPostgresRepository } from "../../../src/auth/infra/database/postgres_repository/delegated_access/issued_credential_postgres_repository";
import { CryptoDelegatedSecretService } from "../../../src/auth/infra/service/crypto_delegated_secret_service";
import { eq } from "drizzle-orm";
import { db } from "../../../src/core/infra/database/drizzle/database";
import { appRegistrationsTable } from "../../../src/core/infra/database/drizzle/schema";

export const secretService = new CryptoDelegatedSecretService();

export async function createAppRegistrationFixture(input?: {
  clientName?: string;
  redirectUris?: string[];
  createdAt?: Date;
}): Promise<AppRegistration> {
  const repository = new AppRegistrationPostgresRepository();
  const entity = AppRegistration.create({
    client_name: input?.clientName ?? "Test App",
    redirect_uris: input?.redirectUris ?? ["https://example.com/callback"],
  });

  const saved = await repository.create(entity);

  if (!input?.createdAt) {
    return saved;
  }

  await db
    .update(appRegistrationsTable)
    .set({ created_at: input.createdAt })
    .where(eq(appRegistrationsTable.id, saved.id));

  const backdated = await repository.findById(saved.id);

  if (!backdated) {
    throw new Error("Failed to backdate app registration fixture");
  }

  return backdated;
}

export async function createConsentFixture(input: {
  userId: string;
  appRegistrationId: string;
  scope?: string;
  grantedAt?: Date;
  lastUsedAt?: Date;
}): Promise<Consent> {
  const repository = new ConsentPostgresRepository();
  const now = new Date();
  const entity = Consent.create({
    user_id: input.userId,
    app_registration_id: input.appRegistrationId,
    scope: input.scope ?? "mcp",
    granted_at: input.grantedAt ?? now,
    last_used_at: input.lastUsedAt ?? now,
  });

  return repository.create(entity);
}

export async function createAuthorizationRequestFixture(input: {
  appRegistrationId: string;
  redirectUri?: string;
  expiresAt?: Date;
}): Promise<{
  authorizationRequest: AuthorizationRequest;
  identifier: string;
}> {
  const repository = new AuthorizationRequestPostgresRepository();
  const { secret, digest } = secretService.generate();

  const entity = AuthorizationRequest.create({
    identifier_digest: digest,
    app_registration_id: input.appRegistrationId,
    redirect_uri: input.redirectUri ?? "https://example.com/callback",
    code_challenge: "test-code-challenge",
    code_challenge_method: "S256",
    scope: "mcp",
    resource: "https://api.stayhub.dev/mcp",
    expires_at: input.expiresAt ?? new Date(Date.now() + 5 * 60 * 1000),
  });

  const authorizationRequest = await repository.create(entity);

  return { authorizationRequest, identifier: secret };
}

export async function createAuthorizationCodeFixture(input: {
  appRegistrationId: string;
  consentId: string;
  redirectUri?: string;
  expiresAt?: Date;
}): Promise<{ authorizationCode: AuthorizationCode; code: string }> {
  const repository = new AuthorizationCodePostgresRepository();
  const { secret, digest } = secretService.generate();

  const entity = AuthorizationCode.create({
    code_digest: digest,
    app_registration_id: input.appRegistrationId,
    consent_id: input.consentId,
    redirect_uri: input.redirectUri ?? "https://example.com/callback",
    code_challenge: "test-code-challenge",
    code_challenge_method: "S256",
    scope: "mcp",
    resource: "https://api.stayhub.dev/mcp",
    expires_at: input.expiresAt ?? new Date(Date.now() + 60 * 1000),
  });

  const authorizationCode = await repository.create(entity);

  return { authorizationCode, code: secret };
}

export async function issueCredentialFixture(input: {
  consentId: string;
  familyId?: string;
  resource?: string;
  accessTokenExpiresAt?: Date;
}): Promise<{
  issuedCredential: IssuedCredential;
  accessToken: string;
  refreshToken: string;
}> {
  const repository = new IssuedCredentialPostgresRepository();
  const access = secretService.generate();
  const refresh = secretService.generate();

  const entity = IssuedCredential.create({
    consent_id: input.consentId,
    family_id: input.familyId ?? crypto.randomUUID(),
    access_token_digest: access.digest,
    access_token_expires_at:
      input.accessTokenExpiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
    refresh_token_digest: refresh.digest,
    refresh_token_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    resource: input.resource ?? "https://api.stayhub.dev/mcp",
  });

  const issuedCredential = await repository.issue(entity);

  return {
    issuedCredential,
    accessToken: access.secret,
    refreshToken: refresh.secret,
  };
}

/**
 * Composes an app registration, a consent, and an issued credential into a
 * single ready-to-use `/mcp` access token — the fixture equivalent of
 * driving the full `/authorize` + `/token` flow, for tests that only care
 * about the resulting credential (task 13: the MCP path authenticates with
 * this instead of a JWT session token). `resource` defaults to `undefined`,
 * which `issueCredentialFixture` resolves to a placeholder that will *not*
 * match a real server's canonical `/mcp` URL — callers that exercise actual
 * audience verification must pass the real `expectedResource` explicitly.
 */
export async function createMcpAccessTokenFixture(input: {
  userId: string;
  resource?: string;
  accessTokenExpiresAt?: Date;
}): Promise<{
  accessToken: string;
  appRegistrationId: string;
  consentId: string;
}> {
  const app = await createAppRegistrationFixture();
  const consent = await createConsentFixture({
    userId: input.userId,
    appRegistrationId: app.id,
  });
  const { accessToken } = await issueCredentialFixture({
    consentId: consent.id,
    resource: input.resource,
    accessTokenExpiresAt: input.accessTokenExpiresAt,
  });

  return { accessToken, appRegistrationId: app.id, consentId: consent.id };
}
