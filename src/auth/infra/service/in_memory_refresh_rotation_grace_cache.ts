import type {
  GraceSuccessorPayload,
  RefreshRotationGraceCache,
} from "../../domain/service/refresh_rotation_grace_cache";

const DEFAULT_MAX_TRACKED_ENTRIES = 10_000;

type Entry = { payload: GraceSuccessorPayload; expiresAt: number };

/**
 * In-process implementation of `RefreshRotationGraceCache`, mirroring
 * `InMemoryRateLimiter`'s shape: bounded by `maxTrackedEntries` so a caller
 * who could somehow force many rotations in flight can't grow this map
 * without limit, and fail-closed at capacity — a `put` that can't fit is
 * silently dropped rather than evicting a live entry, which only means a
 * legitimate concurrent grace lookup gets a miss (denied, not a security
 * hole) instead of corrupting someone else's still-valid entry.
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
    if (this.#entries.size >= this.#maxTrackedEntries) {
      this.#purgeExpired();
    }

    if (this.#entries.size >= this.#maxTrackedEntries) {
      return;
    }

    this.#entries.set(supersededRefreshTokenDigest, {
      payload,
      expiresAt: Date.now() + ttlMs,
    });
  }

  get(supersededRefreshTokenDigest: string): GraceSuccessorPayload | null {
    const entry = this.#entries.get(supersededRefreshTokenDigest);
    if (!entry) {
      return null;
    }

    if (Date.now() >= entry.expiresAt) {
      this.#entries.delete(supersededRefreshTokenDigest);
      return null;
    }

    return entry.payload;
  }

  #purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.#entries) {
      if (now >= entry.expiresAt) {
        this.#entries.delete(key);
      }
    }
  }
}
