import { describe, it, expect, beforeEach } from "bun:test";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { PasswordResetRequest } from "../../src/auth/domain/entity/password_reset_request";
import { PasswordResetRequestPostgresRepository } from "../../src/auth/infra/database/postgres_repository/password_reset_request_postgres_repository";
import { AuthPostgresRepository } from "../../src/auth/infra/database/postgres_repository/auth_postgres_repository";
import { PurgeUserDataUseCase } from "../../src/auth/application/use_case/purge_user_data";
import { CryptoDelegatedSecretService } from "../../src/auth/infra/service/crypto_delegated_secret_service";

const secretService = new CryptoDelegatedSecretService();

async function createPasswordResetRequestFixture(input: {
  userId: string;
  expiresAt?: Date;
}): Promise<{ passwordResetRequest: PasswordResetRequest; token: string }> {
  const repository = new PasswordResetRequestPostgresRepository();
  const { secret, digest } = secretService.generate();

  const entity = PasswordResetRequest.create({
    user_id: input.userId,
    token_digest: digest,
    expires_at: input.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
  });

  const passwordResetRequest = await repository.create(entity);

  return { passwordResetRequest, token: secret };
}

describe("PasswordResetRequestPostgresRepository", () => {
  const repository = new PasswordResetRequestPostgresRepository();

  beforeEach(async () => {
    await truncate(["password_reset_requests", "users"]);
  });

  async function setup() {
    const { user } = await createUserFixture({
      name: "Ada Lovelace",
      email: "ada@sogio.dev",
      password: "correct-horse-battery",
    });
    return { user };
  }

  it("claims an unconsumed request exactly once, atomically, under concurrency (R7)", async () => {
    const { user } = await setup();
    const { token } = await createPasswordResetRequestFixture({
      userId: user.id,
    });
    const digest = secretService.digest(token);

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

  it("returns null when claiming an already-consumed request", async () => {
    const { user } = await setup();
    const { token } = await createPasswordResetRequestFixture({
      userId: user.id,
    });
    const digest = secretService.digest(token);

    const firstClaim = await repository.claim(digest);
    const secondClaim = await repository.claim(digest);

    expect(firstClaim).not.toBeNull();
    expect(secondClaim).toBeNull();
  });

  it("returns null when claiming a digest that does not exist", async () => {
    const claim = await repository.claim(secretService.digest("unknown"));

    expect(claim).toBeNull();
  });

  it("counts requests created within the given window", async () => {
    const { user } = await setup();

    await createPasswordResetRequestFixture({ userId: user.id });
    await createPasswordResetRequestFixture({ userId: user.id });

    const count = await repository.countByUserSince(
      user.id,
      new Date(Date.now() - 60 * 60 * 1000)
    );

    expect(count).toBe(2);
  });

  it("invalidates every pending request for a user (R6)", async () => {
    const { user } = await setup();

    const { token: firstToken } = await createPasswordResetRequestFixture({
      userId: user.id,
    });
    const { token: secondToken } = await createPasswordResetRequestFixture({
      userId: user.id,
    });

    await repository.invalidatePendingByUser(user.id);

    expect(await repository.claim(secretService.digest(firstToken))).toBeNull();
    expect(
      await repository.claim(secretService.digest(secondToken))
    ).toBeNull();
  });

  it("removes expired requests and keeps unexpired ones", async () => {
    const { user } = await setup();

    await createPasswordResetRequestFixture({
      userId: user.id,
      expiresAt: new Date(Date.now() - 60 * 1000),
    });
    const { token: freshToken } = await createPasswordResetRequestFixture({
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * 1000),
    });

    const removed = await repository.deleteExpired(new Date());
    expect(removed).toBe(1);

    const claim = await repository.claim(secretService.digest(freshToken));
    expect(claim).not.toBeNull();
  });

  it("R14 — deleting a user cascades to its password reset requests (LGPD purge doesn't fail on FK)", async () => {
    const { user } = await setup();
    await createPasswordResetRequestFixture({ userId: user.id });

    const purgeUseCase = new PurgeUserDataUseCase(new AuthPostgresRepository());

    await expect(
      purgeUseCase.execute(undefined, user)
    ).resolves.toBeUndefined();

    const remaining = await repository.countByUserSince(user.id, new Date(0));
    expect(remaining).toBe(0);
  });
});
