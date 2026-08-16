import type { PasswordResetRequest } from "../entity/password_reset_request";

export interface PasswordResetRequestRepository {
  create(input: PasswordResetRequest): Promise<PasswordResetRequest>;
  /**
   * Reivindicação atômica (R7), no mesmo molde de
   * `AuthorizationCodeRepository.claim`: `UPDATE ... WHERE consumed_at IS
   * NULL RETURNING ...`. Zero linhas é tratado como reuso/expiração pelo
   * chamador, nunca como "não encontrado" silencioso.
   */
  claim(tokenDigest: string): Promise<PasswordResetRequest | null>;
  countByUserSince(userId: string, since: Date): Promise<number>;
  /**
   * Invalida (marca como consumidos) todos os pedidos ainda pendentes de um
   * usuário (R6) — emitir um novo pedido torna os anteriores inutilizáveis.
   */
  invalidatePendingByUser(userId: string): Promise<void>;
  deleteExpired(before: Date): Promise<number>;
}
