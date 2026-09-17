import { describe, it, expect, beforeEach } from "bun:test";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createLinkedIdentityFixture } from "../helpers/fixtures/linked_identity";
import { LinkedIdentity } from "../../src/auth/domain/entity/linked_identity";
import { LinkedIdentityPostgresRepository } from "../../src/auth/infra/database/postgres_repository/linked_identity_postgres_repository";
import { AuthPostgresRepository } from "../../src/auth/infra/database/postgres_repository/auth_postgres_repository";
import { PurgeUserDataUseCase } from "../../src/auth/application/use_case/purge_user_data";
import { db } from "../../src/core/infra/database/drizzle/database";
import { linkedIdentitiesTable } from "../../src/core/infra/database/drizzle/schema";
import { eq } from "drizzle-orm";

describe("LinkedIdentityPostgresRepository", () => {
  const repository = new LinkedIdentityPostgresRepository();

  beforeEach(async () => {
    await truncate(["linked_identities", "users"]);
  });

  async function setup() {
    const { user } = await createUserFixture({
      name: "Ada Lovelace",
      email: "ada@sogio.dev",
      password: "correct-horse-battery",
    });
    return { user };
  }

  it("creates a linked identity and finds it by provider and subject", async () => {
    const { user } = await setup();

    const created = await createLinkedIdentityFixture({
      userId: user.id,
      subject: "google-subject-123",
    });

    const found = await repository.findByProviderAndSubject(
      "google",
      "google-subject-123"
    );

    expect(found?.id).toBe(created.id);
    expect(found?.user_id).toBe(user.id);
    expect(found?.provider).toBe("google");
    expect(found?.subject).toBe("google-subject-123");
  });

  it("returns null when no identity matches the provider and subject", async () => {
    const found = await repository.findByProviderAndSubject(
      "google",
      "unknown-subject"
    );

    expect(found).toBeNull();
  });

  it("reports whether a user already has an identity for a provider", async () => {
    const { user } = await setup();

    expect(await repository.existsForUserAndProvider(user.id, "google")).toBe(
      false
    );

    await createLinkedIdentityFixture({ userId: user.id });

    expect(await repository.existsForUserAndProvider(user.id, "google")).toBe(
      true
    );
  });

  it("enforces uniqueness on (provider, subject)", async () => {
    const { user } = await setup();
    await createLinkedIdentityFixture({
      userId: user.id,
      subject: "shared-subject",
    });

    const { user: otherUser } = await createUserFixture({
      name: "Grace Hopper",
      email: "grace@sogio.dev",
      password: "correct-horse-battery",
    });

    await expect(
      repository.create(
        LinkedIdentity.create({
          user_id: otherUser.id,
          provider: "google",
          subject: "shared-subject",
        })
      )
    ).rejects.toThrow();
  });

  it("enforces uniqueness on (user_id, provider)", async () => {
    const { user } = await setup();
    await createLinkedIdentityFixture({
      userId: user.id,
      subject: "first-subject",
    });

    await expect(
      repository.create(
        LinkedIdentity.create({
          user_id: user.id,
          provider: "google",
          subject: "second-subject",
        })
      )
    ).rejects.toThrow();
  });

  it("purging a user removes its linked identities (LGPD)", async () => {
    const { user } = await setup();
    await createLinkedIdentityFixture({ userId: user.id });

    const purgeUseCase = new PurgeUserDataUseCase(new AuthPostgresRepository());
    await expect(
      purgeUseCase.execute(undefined, user)
    ).resolves.toBeUndefined();

    const remaining = await db
      .select()
      .from(linkedIdentitiesTable)
      .where(eq(linkedIdentitiesTable.user_id, user.id));

    expect(remaining).toHaveLength(0);
  });
});
