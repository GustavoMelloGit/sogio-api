/**
 * The dimension a rate limit key is derived from.
 *
 * - `"peer-ip"`: the key is the caller's network address, resolved by the
 *   transport layer (see `resolveCallerIp`) — the only identity available
 *   before anything about the request's content has been read.
 * - `"caller-key"`: the key is handed to the primitive directly by whoever
 *   sits at the call site, already fully formed — e.g. an identifier a
 *   route reads out of its own body or params. The primitive stays
 *   completely agnostic of what that identifier means (an OAuth
 *   `client_id`, or anything else a future caller needs a second counting
 *   dimension for); it never derives or interprets this key itself, unlike
 *   `"peer-ip"`, which the transport layer resolves on the primitive's
 *   behalf. This dimension exists purely as a label for call sites that
 *   enforce their own policy directly through `RateLimiter.consume`,
 *   outside the adapter's automatic per-request `peer-ip` check.
 */
export type RateLimitKeyDimension = "peer-ip" | "caller-key";

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
