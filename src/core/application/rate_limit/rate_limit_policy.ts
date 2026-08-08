/**
 * The dimension a rate limit key is derived from. Only "peer-ip" exists
 * today because it's the only caller identity available before any
 * business concept (e.g. an OAuth `client_id`) is authenticated. New
 * dimensions are added here as new callers need them, not hardcoded into
 * the primitive that enforces them.
 */
export type RateLimitKeyDimension = "peer-ip";

/**
 * A rate limiting policy a route declares for itself. The primitive that
 * enforces it (see `RateLimiter`) has no notion of what the route is or why
 * the policy has these numbers.
 */
export type RateLimitPolicy = {
  keyDimension: RateLimitKeyDimension;
  windowMs: number;
  maxAttempts: number;
};
