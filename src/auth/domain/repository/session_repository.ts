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
  /** Encerra todas as sessões do usuário, opcionalmente poupando uma. */
  revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void>;
  /** Remove sessões vencidas há mais de `olderThan` (E9). */
  deleteExpired(olderThan: Date): Promise<number>;
}
