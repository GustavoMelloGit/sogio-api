import type { Session } from "../entity/session";

export interface SessionRepository {
  create(session: Session): Promise<Session>;
  findBySecretDigest(secretDigest: string): Promise<Session | null>;
  /**
   * Registra o uso da sessão. O chamador decide quando vale a escrita — uma
   * por requisição dobraria a escrita do endpoint mais quente.
   */
  touch(sessionId: string, usedAt: Date): Promise<void>;
  revoke(sessionId: string): Promise<void>;
  /** Encerra pelo digest, sem ler antes: um `UPDATE` só, idempotente. */
  revokeBySecretDigest(secretDigest: string): Promise<void>;
  /** Encerra todas as sessões do usuário, opcionalmente poupando uma. */
  revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void>;
  /** Remove sessões mortas: vencidas, ociosas ou revogadas há tempo (E9). */
  deleteExpired(
    now: Date,
    inactivityTtlMs: number,
    revokedGraceMs: number
  ): Promise<number>;
}
