import type { Session } from "../entity/session";

export interface SessionRepository {
  create(session: Session): Promise<Session>;
  findBySecretDigest(secretDigest: string): Promise<Session | null>;
  touch(sessionId: string, usedAt: Date): Promise<void>;
  revoke(sessionId: string): Promise<void>;
  revokeBySecretDigest(secretDigest: string): Promise<void>;
  revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void>;
  deleteExpired(
    now: Date,
    inactivityTtlMs: number,
    revokedGraceMs: number
  ): Promise<number>;
}
