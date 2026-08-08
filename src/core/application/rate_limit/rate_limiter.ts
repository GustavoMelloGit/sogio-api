import type { RateLimitPolicy } from "./rate_limit_policy";

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Applies a `RateLimitPolicy` to a caller-supplied key and decides whether
 * the attempt is allowed. Deliberately generic: it knows nothing about HTTP,
 * OAuth, or any business concept — the key and the policy are handed to it
 * by whoever sits at the transport boundary.
 */
export interface RateLimiter {
  consume(key: string, policy: RateLimitPolicy): RateLimitDecision;
}
