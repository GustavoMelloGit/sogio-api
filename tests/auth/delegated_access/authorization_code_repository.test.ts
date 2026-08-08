import { describe, it, expect, beforeEach } from "bun:test";
import { truncate } from "../../helpers/database";
import { createUserFixture } from "../../helpers/fixtures/user";
import {
  createAppRegistrationFixture,
  createAuthorizationCodeFixture,
  createConsentFixture,
  secretService,
} from "../../helpers/fixtures/delegated_access";
import { AuthorizationCodePostgresRepository } from "../../../src/auth/infra/database/postgres_repository/delegated_access/authorization_code_postgres_repository";

describe("AuthorizationCodePostgresRepository", () => {
  const repository = new AuthorizationCodePostgresRepository();

  beforeEach(async () => {
    await truncate([
      "authorization_codes",
      "consents",
      "app_registrations",
      "users",
    ]);
  });

  async function setup() {
    const { user } = await createUserFixture({
      name: "Ada Lovelace",
      email: "ada@stayhub.dev",
      password: "correct-horse-battery",
    });
    const app = await createAppRegistrationFixture();
    const consent = await createConsentFixture({
      userId: user.id,
      appRegistrationId: app.id,
    });

    return { app, consent };
  }

  it("claims an unconsumed code exactly once, atomically, under concurrency", async () => {
    const { app, consent } = await setup();
    const { code } = await createAuthorizationCodeFixture({
      appRegistrationId: app.id,
      consentId: consent.id,
    });
    const digest = secretService.digest(code);

    const [first, second] = await Promise.all([
      repository.claim(digest),
      repository.claim(digest),
    ]);

    const successes = [first, second].filter(result => result !== null);
    const failures = [first, second].filter(result => result === null);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(successes[0]?.consumed_at).toBeInstanceOf(Date);
  });

  it("returns null when claiming an already-consumed code", async () => {
    const { app, consent } = await setup();
    const { code } = await createAuthorizationCodeFixture({
      appRegistrationId: app.id,
      consentId: consent.id,
    });
    const digest = secretService.digest(code);

    const firstClaim = await repository.claim(digest);
    const secondClaim = await repository.claim(digest);

    expect(firstClaim).not.toBeNull();
    expect(secondClaim).toBeNull();
  });

  it("returns null when claiming a digest that does not exist", async () => {
    const claim = await repository.claim(secretService.digest("unknown"));

    expect(claim).toBeNull();
  });

  it("removes expired codes and keeps unexpired ones", async () => {
    const { app, consent } = await setup();
    await createAuthorizationCodeFixture({
      appRegistrationId: app.id,
      consentId: consent.id,
      expiresAt: new Date(Date.now() - 60 * 1000),
    });
    const { code: freshCode } = await createAuthorizationCodeFixture({
      appRegistrationId: app.id,
      consentId: consent.id,
      expiresAt: new Date(Date.now() + 60 * 1000),
    });

    const removed = await repository.deleteExpired(new Date());
    expect(removed).toBe(1);

    const claim = await repository.claim(secretService.digest(freshCode));
    expect(claim).not.toBeNull();
  });
});
