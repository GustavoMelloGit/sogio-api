import { describe, it, expect, beforeEach } from "bun:test";
import { truncate } from "../../helpers/database";
import { createUserFixture } from "../../helpers/fixtures/user";
import {
  createAppRegistrationFixture,
  createConsentFixture,
} from "../../helpers/fixtures/delegated_access";
import { AppRegistrationPostgresRepository } from "../../../src/auth/infra/database/postgres_repository/delegated_access/app_registration_postgres_repository";

describe("AppRegistrationPostgresRepository", () => {
  const repository = new AppRegistrationPostgresRepository();

  beforeEach(async () => {
    await truncate(["consents", "app_registrations", "users"]);
  });

  it("creates and finds an app registration by id", async () => {
    const created = await createAppRegistrationFixture({
      clientName: "Claude Desktop",
      redirectUris: ["https://claude.ai/callback", "http://127.0.0.1"],
    });

    const found = await repository.findById(created.id);

    expect(found).not.toBeNull();
    expect(found?.client_name).toBe("Claude Desktop");
    expect(found?.redirect_uris).toEqual([
      "https://claude.ai/callback",
      "http://127.0.0.1",
    ]);
    expect(found?.token_endpoint_auth_method).toBe("none");
  });

  it("returns null for an unknown id", async () => {
    const found = await repository.findById(crypto.randomUUID());

    expect(found).toBeNull();
  });

  it("purges registrations older than the threshold with no consent", async () => {
    const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const unused = await createAppRegistrationFixture({ createdAt: old });

    const threshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const purged = await repository.deleteUnusedRegisteredBefore(threshold);

    expect(purged).toBe(1);
    expect(await repository.findById(unused.id)).toBeNull();
  });

  it("does not purge a registration with a consent, even if old", async () => {
    const { user } = await createUserFixture({
      name: "Ada Lovelace",
      email: "ada@sogio.dev",
      password: "correct-horse-battery",
    });
    const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const withConsent = await createAppRegistrationFixture({ createdAt: old });
    await createConsentFixture({
      userId: user.id,
      appRegistrationId: withConsent.id,
    });

    const threshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const purged = await repository.deleteUnusedRegisteredBefore(threshold);

    expect(purged).toBe(0);
    expect(await repository.findById(withConsent.id)).not.toBeNull();
  });

  it("does not purge a registration newer than the threshold", async () => {
    const recent = await createAppRegistrationFixture();

    const threshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const purged = await repository.deleteUnusedRegisteredBefore(threshold);

    expect(purged).toBe(0);
    expect(await repository.findById(recent.id)).not.toBeNull();
  });
});
