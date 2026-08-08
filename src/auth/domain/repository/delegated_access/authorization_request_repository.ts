import type { AuthorizationRequest } from "../../entity/delegated_access/authorization_request";

export interface AuthorizationRequestRepository {
  create(input: AuthorizationRequest): Promise<AuthorizationRequest>;
  findByIdentifierDigest(
    identifierDigest: string
  ): Promise<AuthorizationRequest | null>;
  /**
   * Reivindicação atômica (E4): `UPDATE ... WHERE consumed_at IS NULL
   * RETURNING ...`. Retorna `null` quando o pedido não existe, já foi
   * consumido ou expirou — os três casos tratados como "não posso prosseguir
   * com este pedido" pelo chamador.
   */
  claim(identifierDigest: string): Promise<AuthorizationRequest | null>;
  deleteExpired(before: Date): Promise<number>;
}
