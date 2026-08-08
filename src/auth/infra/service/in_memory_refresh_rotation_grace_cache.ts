import type {
  GraceSuccessorPayload,
  RefreshRotationGraceCache,
} from "../../domain/service/refresh_rotation_grace_cache";

const DEFAULT_MAX_TRACKED_ENTRIES = 10_000;

type Entry = { payload: GraceSuccessorPayload; timer: Timer };

/**
 * In-process implementation of `RefreshRotationGraceCache`, mirroring
 * `InMemoryRateLimiter`'s shape for its capacity guard: bounded by
 * `maxTrackedEntries` so a caller who could somehow force many rotations in
 * flight can't grow this map without limit, and fail-closed at capacity — a
 * `put` that can't fit is silently dropped rather than evicting a live
 * entry, which only means a legitimate concurrent grace lookup gets a miss
 * (denied, not a security hole) instead of corrupting someone else's
 * still-valid entry.
 *
 * **Correção pós-revisão (M4).** Unlike the rate limiter, this cache never
 * relies on a later `put`/capacity check to reclaim space: every entry
 * schedules its own removal — a `setTimeout(ttlMs).unref()` that deletes it
 * when the grace window elapses — and `get` deletes an entry outright on
 * its first successful read, since there is only ever one legitimate loser
 * to hand a given payload to (E4's two-way race). Either path guarantees an
 * entry never outlives its purpose regardless of how much (or how little)
 * traffic the process sees afterward — the previous version only purged
 * expired entries when the map reached capacity, so a process performing
 * fewer than `maxTrackedEntries` rotations total never removed a single one,
 * holding every rotation's clear-text access/refresh token pair in memory
 * for the life of the process instead of for the intended few seconds.
 * `.unref()` keeps a pending timer from holding the process open.
 */
export class InMemoryRefreshRotationGraceCache
  implements RefreshRotationGraceCache
{
  readonly #entries = new Map<string, Entry>();
  readonly #maxTrackedEntries: number;

  constructor(maxTrackedEntries: number = DEFAULT_MAX_TRACKED_ENTRIES) {
    this.#maxTrackedEntries = maxTrackedEntries;
  }

  put(
    supersededRefreshTokenDigest: string,
    payload: GraceSuccessorPayload,
    ttlMs: number
  ): void {
    this.#delete(supersededRefreshTokenDigest);

    if (this.#entries.size >= this.#maxTrackedEntries) {
      return;
    }

    const timer = setTimeout(() => {
      this.#entries.delete(supersededRefreshTokenDigest);
    }, ttlMs).unref();

    this.#entries.set(supersededRefreshTokenDigest, { payload, timer });
  }

  get(supersededRefreshTokenDigest: string): GraceSuccessorPayload | null {
    const entry = this.#entries.get(supersededRefreshTokenDigest);
    if (!entry) {
      return null;
    }

    this.#delete(supersededRefreshTokenDigest);
    return entry.payload;
  }

  #delete(key: string): void {
    const entry = this.#entries.get(key);
    if (!entry) {
      return;
    }

    clearTimeout(entry.timer);
    this.#entries.delete(key);
  }
}
