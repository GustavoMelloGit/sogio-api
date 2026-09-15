import { SessionManager } from "../../../src/auth/application/service/session_manager";
import { SessionPostgresRepository } from "../../../src/auth/infra/database/postgres_repository/session_postgres_repository";
import { CryptoDelegatedSecretService } from "../../../src/auth/infra/service/crypto_delegated_secret_service";

/**
 * Cria uma sessão de verdade e devolve o segredo. Antes forjava um JWT: agora
 * a sessão existe no banco, como a do usuário real, então um teste que a
 * encerra ou a deixa expirar exercita o mesmo caminho da produção.
 */
export async function createAuthToken(userId: string): Promise<string> {
  const sessionManager = new SessionManager(
    new SessionPostgresRepository(),
    new CryptoDelegatedSecretService()
  );

  return sessionManager.createSession(userId);
}
