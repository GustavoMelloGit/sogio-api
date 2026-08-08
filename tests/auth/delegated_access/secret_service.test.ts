import { describe, it, expect } from "bun:test";
import { CryptoDelegatedSecretService } from "../../../src/auth/infra/service/crypto_delegated_secret_service";

describe("CryptoDelegatedSecretService", () => {
  const service = new CryptoDelegatedSecretService();

  it("generates secrets with at least 32 bytes of entropy, base64url encoded", () => {
    const { secret } = service.generate();

    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);

    const decodedByteLength = Buffer.from(secret, "base64url").length;
    expect(decodedByteLength).toBeGreaterThanOrEqual(32);
  });

  it("generates a different secret on every call", () => {
    const first = service.generate();
    const second = service.generate();

    expect(first.secret).not.toBe(second.secret);
    expect(first.digest).not.toBe(second.digest);
  });

  it("returns the sha-256 digest of the generated secret alongside it", () => {
    const { secret, digest } = service.generate();

    expect(digest).toBe(service.digest(secret));
  });

  it("produces a deterministic 64-character hex digest for the same secret", () => {
    const { secret } = service.generate();

    const digestA = service.digest(secret);
    const digestB = service.digest(secret);

    expect(digestA).toBe(digestB);
    expect(digestA).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different digests for different secrets", () => {
    const digestA = service.digest("secret-a");
    const digestB = service.digest("secret-b");

    expect(digestA).not.toBe(digestB);
  });
});
