import { describe, it, expect, beforeEach } from "bun:test";
import { truncate } from "../../helpers/database";
import { createUserFixture } from "../../helpers/fixtures/user";
import {
  createAppRegistrationFixture,
  createConsentFixture,
} from "../../helpers/fixtures/delegated_access";
import { ConsentPostgresRepository } from "../../../src/auth/infra/database/postgres_repository/delegated_access/consent_postgres_repository";

describe("ConsentPostgresRepository", () => {
  const repository = new ConsentPostgresRepository();

  beforeEach(async () => {
    await truncate(["consents", "app_registrations", "users"]);
  });

  it("creates a consent and finds it by id", async () => {
    const { user } = await createUserFixture({
      name: "Ada Lovelace",
      email: "ada@stayhub.dev",
      password: "correct-horse-battery",
    });
    const app = await createAppRegistrationFixture();

    const created = await createConsentFixture({
      userId: user.id,
      appRegistrationId: app.id,
    });

    const found = await repository.findById(created.id);

    expect(found).not.toBeNull();
    expect(found?.user_id).toBe(user.id);
    expect(found?.app_registration_id).toBe(app.id);
    expect(found?.revoked_at).toBeFalsy();
  });

  it("finds a consent by (user, app) and returns null for other combinations", async () => {
    const { user } = await createUserFixture({
      name: "Ada Lovelace",
      email: "ada@stayhub.dev",
      password: "correct-horse-battery",
    });
    const { user: otherUser } = await createUserFixture({
      name: "Grace Hopper",
      email: "grace@stayhub.dev",
      password: "correct-horse-battery",
    });
    const app = await createAppRegistrationFixture();
    const otherApp = await createAppRegistrationFixture();

    const created = await createConsentFixture({
      userId: user.id,
      appRegistrationId: app.id,
    });

    const found = await repository.findByUserAndApp(user.id, app.id);
    expect(found?.id).toBe(created.id);

    expect(await repository.findByUserAndApp(otherUser.id, app.id)).toBeNull();
    expect(await repository.findByUserAndApp(user.id, otherApp.id)).toBeNull();
  });

  it("revokes a consent, setting revoked_at", async () => {
    const { user } = await createUserFixture({
      name: "Ada Lovelace",
      email: "ada@stayhub.dev",
      password: "correct-horse-battery",
    });
    const app = await createAppRegistrationFixture();
    const created = await createConsentFixture({
      userId: user.id,
      appRegistrationId: app.id,
    });

    await repository.revoke(created.id);

    const found = await repository.findById(created.id);
    expect(found?.revoked_at).toBeInstanceOf(Date);
  });
});
