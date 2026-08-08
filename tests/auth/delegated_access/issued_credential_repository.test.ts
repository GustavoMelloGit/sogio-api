import { describe, it, expect, beforeEach } from "bun:test";
import { truncate } from "../../helpers/database";
import { createUserFixture } from "../../helpers/fixtures/user";
import {
  createAppRegistrationFixture,
  createConsentFixture,
  issueCredentialFixture,
  secretService,
} from "../../helpers/fixtures/delegated_access";
import { IssuedCredential } from "../../../src/auth/domain/entity/delegated_access/issued_credential";
import { IssuedCredentialPostgresRepository } from "../../../src/auth/infra/database/postgres_repository/delegated_access/issued_credential_postgres_repository";

describe("IssuedCredentialPostgresRepository", () => {
  const repository = new IssuedCredentialPostgresRepository();

  beforeEach(async () => {
    await truncate([
      "issued_credentials",
      "consents",
      "app_registrations",
      "users",
    ]);
  });

  async function setupConsent() {
    const { user } = await createUserFixture({
      name: "Ada Lovelace",
      email: "ada@stayhub.dev",
      password: "correct-horse-battery",
    });
    const app = await createAppRegistrationFixture();

    return createConsentFixture({
      userId: user.id,
      appRegistrationId: app.id,
    });
  }

  it("issues a credential and finds it by access or refresh token digest", async () => {
    const consent = await setupConsent();
    const { issuedCredential, accessToken, refreshToken } =
      await issueCredentialFixture({ consentId: consent.id });

    const byAccess = await repository.findByAccessTokenDigest(
      secretService.digest(accessToken)
    );
    const byRefresh = await repository.findByRefreshTokenDigest(
      secretService.digest(refreshToken)
    );

    expect(byAccess?.id).toBe(issuedCredential.id);
    expect(byRefresh?.id).toBe(issuedCredential.id);
    expect(byAccess?.family_id).toBe(issuedCredential.family_id);
    expect(byAccess?.rotated_at).toBeFalsy();
    expect(byAccess?.revoked_at).toBeFalsy();
  });

  it("enforces a unique index on the access token digest", async () => {
    const consent = await setupConsent();
    const digest = secretService.digest("shared-secret");

    const first = IssuedCredential.create({
      consent_id: consent.id,
      family_id: crypto.randomUUID(),
      access_token_digest: digest,
      access_token_expires_at: new Date(Date.now() + 60_000),
      refresh_token_digest: secretService.digest("refresh-a"),
      refresh_token_expires_at: new Date(Date.now() + 60_000),
      resource: "https://api.stayhub.dev/mcp",
    });
    await repository.issue(first);

    const duplicate = IssuedCredential.create({
      consent_id: consent.id,
      family_id: crypto.randomUUID(),
      access_token_digest: digest,
      access_token_expires_at: new Date(Date.now() + 60_000),
      refresh_token_digest: secretService.digest("refresh-b"),
      refresh_token_expires_at: new Date(Date.now() + 60_000),
      resource: "https://api.stayhub.dev/mcp",
    });

    await expect(repository.issue(duplicate)).rejects.toThrow();
  });

  it("rotates a refresh token, linking predecessor to successor within the same family", async () => {
    const consent = await setupConsent();
    const { issuedCredential, refreshToken } = await issueCredentialFixture({
      consentId: consent.id,
    });

    const successor = IssuedCredential.create({
      consent_id: consent.id,
      family_id: issuedCredential.family_id,
      access_token_digest: secretService.digest("rotated-access"),
      access_token_expires_at: new Date(Date.now() + 60_000),
      refresh_token_digest: secretService.digest("rotated-refresh"),
      refresh_token_expires_at: new Date(Date.now() + 60_000),
      resource: issuedCredential.resource,
    });

    const rotated = await repository.rotateRefreshToken(
      secretService.digest(refreshToken),
      successor
    );

    expect(rotated?.id).toBe(successor.id);
    expect(rotated?.family_id).toBe(issuedCredential.family_id);

    const predecessor = await repository.findByRefreshTokenDigest(
      secretService.digest(refreshToken)
    );
    expect(predecessor?.rotated_at).toBeInstanceOf(Date);
    expect(predecessor?.successor_id).toBe(successor.id);
  });

  it("rotates a refresh token exactly once, atomically, under concurrency", async () => {
    const consent = await setupConsent();
    const { issuedCredential, refreshToken } = await issueCredentialFixture({
      consentId: consent.id,
    });
    const digest = secretService.digest(refreshToken);

    const successorA = IssuedCredential.create({
      consent_id: consent.id,
      family_id: issuedCredential.family_id,
      access_token_digest: secretService.digest("race-access-a"),
      access_token_expires_at: new Date(Date.now() + 60_000),
      refresh_token_digest: secretService.digest("race-refresh-a"),
      refresh_token_expires_at: new Date(Date.now() + 60_000),
      resource: issuedCredential.resource,
    });
    const successorB = IssuedCredential.create({
      consent_id: consent.id,
      family_id: issuedCredential.family_id,
      access_token_digest: secretService.digest("race-access-b"),
      access_token_expires_at: new Date(Date.now() + 60_000),
      refresh_token_digest: secretService.digest("race-refresh-b"),
      refresh_token_expires_at: new Date(Date.now() + 60_000),
      resource: issuedCredential.resource,
    });

    const [first, second] = await Promise.all([
      repository.rotateRefreshToken(digest, successorA),
      repository.rotateRefreshToken(digest, successorB),
    ]);

    const successes = [first, second].filter(result => result !== null);
    expect(successes).toHaveLength(1);

    const family = await repository.findByFamily(issuedCredential.family_id);
    // predecessor + exactly one successor, never both race attempts
    expect(family).toHaveLength(2);
  });

  it("revokes only the family originated from the reused code, not sibling families of the same consent", async () => {
    const consent = await setupConsent();
    const familyA = await issueCredentialFixture({ consentId: consent.id });
    const familyB = await issueCredentialFixture({ consentId: consent.id });

    await repository.revokeFamily(familyA.issuedCredential.family_id);

    const revoked = await repository.findByRefreshTokenDigest(
      secretService.digest(familyA.refreshToken)
    );
    const untouched = await repository.findByRefreshTokenDigest(
      secretService.digest(familyB.refreshToken)
    );

    expect(revoked?.revoked_at).toBeInstanceOf(Date);
    expect(untouched?.revoked_at).toBeFalsy();
  });

  it("cascades revocation over every family when the consent is revoked", async () => {
    const consent = await setupConsent();
    const familyA = await issueCredentialFixture({ consentId: consent.id });
    const familyB = await issueCredentialFixture({ consentId: consent.id });

    await repository.revokeAllByConsent(consent.id);

    const a = await repository.findByRefreshTokenDigest(
      secretService.digest(familyA.refreshToken)
    );
    const b = await repository.findByRefreshTokenDigest(
      secretService.digest(familyB.refreshToken)
    );

    expect(a?.revoked_at).toBeInstanceOf(Date);
    expect(b?.revoked_at).toBeInstanceOf(Date);
  });
});
