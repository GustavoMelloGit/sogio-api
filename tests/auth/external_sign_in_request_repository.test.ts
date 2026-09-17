import { describe, it, expect, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { truncate } from "../helpers/database";
import { ExternalSignInRequest } from "../../src/auth/domain/entity/external_sign_in_request";
import { ExternalSignInRequestPostgresRepository } from "../../src/auth/infra/database/postgres_repository/external_sign_in_request_postgres_repository";
import { CryptoDelegatedSecretService } from "../../src/auth/infra/service/crypto_delegated_secret_service";
import { db } from "../../src/core/infra/database/drizzle/database";
import { externalSignInRequestsTable } from "../../src/core/infra/database/drizzle/schema";

const secretService = new CryptoDelegatedSecretService();

function createRequestFixture(
  overrides: { expiresAt?: Date; stateDigest?: string } = {}
): ExternalSignInRequest {
  const { digest: stateDigest } = secretService.generate();
  const { digest: nonceDigest } = secretService.generate();

  return ExternalSignInRequest.create({
    provider: "google",
    state_digest: overrides.stateDigest ?? stateDigest,
    code_challenge: `challenge-${crypto.randomUUID()}`,
    nonce_digest: nonceDigest,
    expires_at: overrides.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000),
  });
}

describe("ExternalSignInRequestPostgresRepository", () => {
  const repository = new ExternalSignInRequestPostgresRepository();

  beforeEach(async () => {
    await truncate(["external_sign_in_requests"]);
  });

  it("claims a request exactly once, atomically, under concurrency", async () => {
    const created = await repository.create(createRequestFixture());

    const [first, second] = await Promise.all([
      repository.claim(created.state_digest),
      repository.claim(created.state_digest),
    ]);

    const successes = [first, second].filter(result => result !== null);
    const failures = [first, second].filter(result => result === null);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(successes[0]?.consumed_at).toBeInstanceOf(Date);
  });

  it("returns null when claiming an already-consumed request", async () => {
    const created = await repository.create(createRequestFixture());

    const firstClaim = await repository.claim(created.state_digest);
    const secondClaim = await repository.claim(created.state_digest);

    expect(firstClaim).not.toBeNull();
    expect(secondClaim).toBeNull();
  });

  it("returns null when claiming a digest that does not exist", async () => {
    const claim = await repository.claim(secretService.digest("unknown"));

    expect(claim).toBeNull();
  });

  it("does not claim an expired request", async () => {
    const created = await repository.create(
      createRequestFixture({ expiresAt: new Date(Date.now() - 1000) })
    );

    const claimed = await repository.claim(created.state_digest);

    expect(claimed).toBeNull();
  });

  it("the stored row never contains the state in the clear", async () => {
    const { secret: state, digest: stateDigest } = secretService.generate();

    await repository.create(createRequestFixture({ stateDigest }));

    const rows = await db.select().from(externalSignInRequestsTable);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.state_digest).toBe(stateDigest);
    expect(JSON.stringify(rows)).not.toContain(state);
  });

  it("deleteExpired removes only the expired requests", async () => {
    const expired = await repository.create(
      createRequestFixture({ expiresAt: new Date(Date.now() - 1000) })
    );
    const fresh = await repository.create(createRequestFixture());

    const removed = await repository.deleteExpired(new Date());

    expect(removed).toBe(1);

    const remainingFresh = await db
      .select()
      .from(externalSignInRequestsTable)
      .where(eq(externalSignInRequestsTable.id, fresh.id));
    const remainingExpired = await db
      .select()
      .from(externalSignInRequestsTable)
      .where(eq(externalSignInRequestsTable.id, expired.id));

    expect(remainingFresh).toHaveLength(1);
    expect(remainingExpired).toHaveLength(0);
  });
});
