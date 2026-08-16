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
  /**
   * Expurgo por retenção (R14/LGPD) — critério é `created_at`, nunca
   * `expires_at`. O TTL do token (1h) já é aplicado onde importa
   * (`ResetPasswordUseCase`, via `expires_at`); apagar a *linha* por esse
   * mesmo critério destruiria a base de cálculo da cota mensal, que conta
   * por `created_at` numa janela de 30 dias — um pedido "expirado" com 1h
   * de vida ainda precisa continuar contando contra a cota pelos 30 dias
   * inteiros. Chamar sempre com o início da janela da cota, nunca com
   * `now()`.
   */
  deleteOlderThan(before: Date): Promise<number>;
}
