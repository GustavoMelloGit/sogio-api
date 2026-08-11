/**
 * The successor credential's clear-text secrets, exactly as they were
 * handed to whoever won the atomic rotation — see
 * `RefreshRotationGraceCache`'s docstring for why these have to be cached
 * rather than recomputed.
 */
export type GraceSuccessorPayload = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  scope: string;
};

/**
 * Bridges the one gap opaque, digest-at-rest credentials leave open for
 * E4's rotation grace window. `IssuedCredentialRepository.rotateRefreshToken`
 * only ever returns the successor's clear-text secrets to whichever caller's
 * atomic claim wins; nothing durable stores them undigested (E10), so a
 * second, legitimate, concurrent caller presenting the same now-superseded
 * refresh token moments later has no way to be handed back the *identical*
 * successor secrets from the database — the digest that's stored can't be
 * reversed. `RefreshAccessTokenUseCase` stashes the winner's clear-text
 * payload here, keyed by the digest of the refresh token that was just
 * superseded, for exactly the grace window's duration, so a losing
 * concurrent call can still return the same successor instead of either
 * minting a new one (forbidden by E4 — it would fork the chain) or denying
 * a legitimate request.
 *
 * Deliberately a short-lived, process-memory cache and not a store of
 * record, and never persisted to disk, so this doesn't create a new form of
 * "secret at rest" the way a database column would (E10's concern). An
 * entry is removed the moment it stops being useful: `get` deletes it on its
 * first successful read (there is only ever one legitimate loser to hand it
 * to — see E4's two-way race), and a `put` that is never read is removed
 * automatically once `ttlMs` elapses via a scheduled timer, not on some
 * later, unrelated write or only once the map hits capacity.
 * **Correção pós-revisão (M4)**: this is the fix — the previous
 * implementation only purged expired entries when the map reached its
 * 10,000-entry cap, so a process doing fewer rotations than that never
 * removed a single expired entry, holding every rotation's clear-text
 * payload in memory indefinitely instead of for the intended few seconds.
 * Single-instance only, like the rate limiter (see the MCP OAuth
 * authorization plan's Dívidas) — a second process instance would need this
 * moved to shared storage.
 */
export interface RefreshRotationGraceCache {
  put(
    supersededRefreshTokenDigest: string,
    payload: GraceSuccessorPayload,
    ttlMs: number
  ): void;
  get(supersededRefreshTokenDigest: string): GraceSuccessorPayload | null;
}
