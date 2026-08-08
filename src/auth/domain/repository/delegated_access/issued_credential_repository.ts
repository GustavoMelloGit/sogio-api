import type { IssuedCredential } from "../../entity/delegated_access/issued_credential";

export interface IssuedCredentialRepository {
  /** Emite a primeira credencial de uma família (troca do código por token). */
  issue(input: IssuedCredential): Promise<IssuedCredential>;
  findByAccessTokenDigest(digest: string): Promise<IssuedCredential | null>;
  findByRefreshTokenDigest(digest: string): Promise<IssuedCredential | null>;
  /**
   * Rotação atômica da credencial de renovação (E4): insere `successor` e,
   * na mesma transação, reivindica a credencial atual via
   * `UPDATE ... WHERE refresh_token_digest = $1 AND rotated_at IS NULL AND
   * revoked_at IS NULL RETURNING ...`. Se a reivindicação falhar (a
   * credencial já foi rotacionada ou revogada), a transação é desfeita e o
   * método retorna `null` — cabe ao chamador consultar
   * `findByRefreshTokenDigest` para decidir entre janela de graça (devolver
   * a mesma sucessora já emitida) e reuso de verdade.
   */
  rotateRefreshToken(
    currentRefreshTokenDigest: string,
    successor: IssuedCredential
  ): Promise<IssuedCredential | null>;
  findByFamily(familyId: string): Promise<IssuedCredential[]>;
  /** Reuso fora da janela de graça: revoga apenas a família originada do código. */
  revokeFamily(familyId: string): Promise<void>;
  /** Cascata de revogação do Consentimento (ação explícita do usuário ou E9). */
  revokeAllByConsent(consentId: string): Promise<void>;
}
