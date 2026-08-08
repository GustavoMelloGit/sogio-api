import { describe, it, expect, beforeEach } from "bun:test";
import { truncate } from "../../helpers/database";
import {
  createAppRegistrationFixture,
  createAuthorizationRequestFixture,
  secretService,
} from "../../helpers/fixtures/delegated_access";
import { AuthorizationRequestPostgresRepository } from "../../../src/auth/infra/database/postgres_repository/delegated_access/authorization_request_postgres_repository";

describe("AuthorizationRequestPostgresRepository", () => {
  const repository = new AuthorizationRequestPostgresRepository();

  beforeEach(async () => {
    await truncate(["authorization_requests", "app_registrations"]);
  });

  it("creates a request and finds it by identifier digest without consuming it", async () => {
    const app = await createAppRegistrationFixture();
    const { identifier } = await createAuthorizationRequestFixture({
      appRegistrationId: app.id,
    });

    const found = await repository.findByIdentifierDigest(
      secretService.digest(identifier)
    );

    expect(found).not.toBeNull();
    expect(found?.consumed_at).toBeFalsy();
    expect(found?.app_registration_id).toBe(app.id);
  });

  it("claims an unconsumed request exactly once, atomically, under concurrency", async () => {
    const app = await createAppRegistrationFixture();
    const { identifier } = await createAuthorizationRequestFixture({
      appRegistrationId: app.id,
    });
    const digest = secretService.digest(identifier);

    const [first, second] = await Promise.all([
      repository.claim(digest),
      repository.claim(digest),
    ]);

    const successes = [first, second].filter(result => result !== null);
    expect(successes).toHaveLength(1);
  });

  it("returns null when claiming an unknown or already-consumed request", async () => {
    const app = await createAppRegistrationFixture();
    const { identifier } = await createAuthorizationRequestFixture({
      appRegistrationId: app.id,
    });
    const digest = secretService.digest(identifier);

    expect(await repository.claim(digest)).not.toBeNull();
    expect(await repository.claim(digest)).toBeNull();
    expect(await repository.claim(secretService.digest("ghost"))).toBeNull();
  });

  it("removes expired requests and keeps unexpired ones", async () => {
    const app = await createAppRegistrationFixture();
    await createAuthorizationRequestFixture({
      appRegistrationId: app.id,
      expiresAt: new Date(Date.now() - 60 * 1000),
    });
    const { identifier: freshIdentifier } =
      await createAuthorizationRequestFixture({
        appRegistrationId: app.id,
        expiresAt: new Date(Date.now() + 60 * 1000),
      });

    const removed = await repository.deleteExpired(new Date());
    expect(removed).toBe(1);

    const found = await repository.findByIdentifierDigest(
      secretService.digest(freshIdentifier)
    );
    expect(found).not.toBeNull();
  });
});
