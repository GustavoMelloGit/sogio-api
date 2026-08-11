import type {
  RateLimitDecision,
  RateLimiter,
} from "../../application/rate_limit/rate_limiter";
import type { RateLimitPolicy } from "../../application/rate_limit/rate_limit_policy";

const DEFAULT_MAX_TRACKED_KEYS = 50_000;

type Entry = {
  count: number;
  windowStart: number;
  windowMs: number;
};

/**
 * Fixed-window rate limiter, counting in process memory. Fixed window is
 * chosen over sliding window because it needs no extra bookkeeping (no
 * timestamp log per attempt) and the imprecision it trades away — a caller
 * can burst up to `2 * maxAttempts` across a window boundary — is
 * acceptable for the abuse this primitive defends against (registration and
 * token spam), not for anything requiring exact accounting.
 *
 * Bounded by `maxTrackedKeys` so a caller who cycles through a new key per
 * request (e.g. a different IP per attempt) can't grow this map without
 * limit. When at capacity, expired entries are purged first to reclaim
 * space; if that isn't enough, a *new* key is denied outright rather than
 * evicting a still-active entry. Evicting an active entry to make room
 * would itself be fail-open — it hands the evicted key a fresh window,
 * which is exactly the bypass a cap exists to prevent. Fail-closed for new
 * keys at capacity is deliberate and documented as such (see E5 in the MCP
 * OAuth authorization plan).
 */
export class InMemoryRateLimiter implements RateLimiter {
  readonly #entries = new Map<string, Entry>();
  readonly #maxTrackedKeys: number;

  constructor(maxTrackedKeys: number = DEFAULT_MAX_TRACKED_KEYS) {
    this.#maxTrackedKeys = maxTrackedKeys;
  }

  consume(key: string, policy: RateLimitPolicy): RateLimitDecision {
    const now = Date.now();
    const existing = this.#entries.get(key);

    if (existing) {
      return this.#consumeExisting(key, existing, policy, now);
    }

    return this.#consumeNew(key, policy, now);
  }

  #consumeExisting(
    key: string,
    entry: Entry,
    policy: RateLimitPolicy,
    now: number
  ): RateLimitDecision {
    if (now - entry.windowStart >= entry.windowMs) {
      this.#entries.set(key, {
        count: 1,
        windowStart: now,
        windowMs: policy.windowMs,
      });
      return { allowed: true };
    }

    const count = entry.count + 1;
    this.#entries.set(key, { ...entry, count });

    if (count > policy.maxAttempts) {
      return this.#deny(policy.windowMs);
    }

    return { allowed: true };
  }

  #consumeNew(
    key: string,
    policy: RateLimitPolicy,
    now: number
  ): RateLimitDecision {
    if (this.#entries.size >= this.#maxTrackedKeys) {
      this.#purgeExpired(now);
    }

    if (this.#entries.size >= this.#maxTrackedKeys) {
      return this.#deny(policy.windowMs);
    }

    this.#entries.set(key, {
      count: 1,
      windowStart: now,
      windowMs: policy.windowMs,
    });
    return { allowed: true };
  }

  #purgeExpired(now: number): void {
    for (const [key, entry] of this.#entries) {
      if (now - entry.windowStart >= entry.windowMs) {
        this.#entries.delete(key);
      }
    }
  }

  #deny(windowMs: number): RateLimitDecision {
    return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }
}
