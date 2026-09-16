import { SessionManager } from "../../../src/auth/application/service/session_manager";
import { SessionPostgresRepository } from "../../../src/auth/infra/database/postgres_repository/session_postgres_repository";
import { CryptoDelegatedSecretService } from "../../../src/auth/infra/service/crypto_delegated_secret_service";

export async function createAuthToken(userId: string): Promise<string> {
  const sessionManager = new SessionManager(
    new SessionPostgresRepository(),
    new CryptoDelegatedSecretService()
  );

  return sessionManager.createSession(userId);
}
