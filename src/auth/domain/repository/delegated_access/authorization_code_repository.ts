import type { AuthorizationCode } from "../../entity/delegated_access/authorization_code";

export interface AuthorizationCodeRepository {
  create(input: AuthorizationCode): Promise<AuthorizationCode>;
  /**
   * Reivindicação atômica (E4): `UPDATE ... WHERE consumed_at IS NULL
   * RETURNING ...`. Zero linhas afetadas é tratado como reuso pelo chamador,
   * nunca como "não encontrado" silencioso — é o que aciona a revogação da
   * família de credenciais originada deste código.
   */
  claim(codeDigest: string): Promise<AuthorizationCode | null>;
  deleteExpired(before: Date): Promise<number>;
}
