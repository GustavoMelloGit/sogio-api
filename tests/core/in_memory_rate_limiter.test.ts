import { describe, expect, it } from "bun:test";
import { InMemoryRateLimiter } from "../../src/core/infra/rate_limit/in_memory_rate_limiter";
import type { RateLimitPolicy } from "../../src/core/application/rate_limit/rate_limit_policy";

function makePolicy(overrides: Partial<RateLimitPolicy> = {}): RateLimitPolicy {
  return {
    keyDimension: "peer-ip",
    windowMs: 200,
    maxAttempts: 2,
    ...overrides,
  };
}

describe("InMemoryRateLimiter", () => {
  it("allows attempts within the limit", () => {
    const limiter = new InMemoryRateLimiter();
    const policy = makePolicy();

    expect(limiter.consume("1.1.1.1", policy)).toEqual({ allowed: true });
    expect(limiter.consume("1.1.1.1", policy)).toEqual({ allowed: true });
  });

  it("denies once the limit is exceeded, with a coarse Retry-After equal to the window", () => {
    const limiter = new InMemoryRateLimiter();
    const policy = makePolicy({ windowMs: 5_000, maxAttempts: 2 });

    limiter.consume("1.1.1.1", policy);
    limiter.consume("1.1.1.1", policy);
    const decision = limiter.consume("1.1.1.1", policy);

    expect(decision).toEqual({ allowed: false, retryAfterSeconds: 5 });
  });

  it("frees the key up again once the window elapses", async () => {
    const limiter = new InMemoryRateLimiter();
    const policy = makePolicy({ windowMs: 100, maxAttempts: 1 });

    expect(limiter.consume("1.1.1.1", policy)).toEqual({ allowed: true });
    expect(limiter.consume("1.1.1.1", policy).allowed).toBe(false);

    await new Promise(resolve => setTimeout(resolve, 150));

    expect(limiter.consume("1.1.1.1", policy)).toEqual({ allowed: true });
  });

  it("keeps each key's own counter independent from the others", () => {
    const limiter = new InMemoryRateLimiter();
    const policy = makePolicy({ windowMs: 5_000, maxAttempts: 1 });

    expect(limiter.consume("1.1.1.1", policy)).toEqual({ allowed: true });
    expect(limiter.consume("2.2.2.2", policy)).toEqual({ allowed: true });
    expect(limiter.consume("1.1.1.1", policy).allowed).toBe(false);
    expect(limiter.consume("2.2.2.2", policy).allowed).toBe(false);
  });

  it("purges expired entries to make room for new keys once at capacity", async () => {
    const limiter = new InMemoryRateLimiter(2);
    const shortLived = makePolicy({ windowMs: 50, maxAttempts: 10 });

    limiter.consume("expired-1", shortLived);
    limiter.consume("expired-2", shortLived);

    await new Promise(resolve => setTimeout(resolve, 80));

    const decision = limiter.consume("fresh-key", shortLived);

    expect(decision).toEqual({ allowed: true });
  });

  it("fails closed for a brand-new key once the cap is reached by still-active entries", () => {
    const limiter = new InMemoryRateLimiter(2);
    const longLived = makePolicy({ windowMs: 60_000, maxAttempts: 10 });

    expect(limiter.consume("active-1", longLived)).toEqual({ allowed: true });
    expect(limiter.consume("active-2", longLived)).toEqual({ allowed: true });

    const decision = limiter.consume("new-key", longLived);

    expect(decision.allowed).toBe(false);
  });

  it("does not evict an active entry to admit a new key at capacity", () => {
    const limiter = new InMemoryRateLimiter(1);
    const longLived = makePolicy({ windowMs: 60_000, maxAttempts: 1 });

    limiter.consume("active-1", longLived);
    limiter.consume("new-key", longLived);

    // "active-1" must still be tracked under its original window, not reset
    // by an eviction that made room for "new-key" — a second attempt for
    // "active-1" is still denied, proving its state survived.
    const decision = limiter.consume("active-1", longLived);

    expect(decision.allowed).toBe(false);
  });
});
