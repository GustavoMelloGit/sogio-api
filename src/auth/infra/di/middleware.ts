import {
  apiBaseUrl,
  consentAbsoluteLifetimeMs,
  consentInactivityTtlMs,
} from "../../../core/infra/config/environments";
import {
  SessionManager,
  type ISessionManager,
} from "../../application/service/session_manager";
import type { CredentialVerifier } from "../../application/service/credential_verifier";
import type { AuthRepository } from "../../domain/repository/auth_repository";
import type { ConsentRepository } from "../../domain/repository/delegated_access/consent_repository";
import type { IssuedCredentialRepository } from "../../domain/repository/delegated_access/issued_credential_repository";
import type { DelegatedSecretService } from "../../domain/service/delegated_secret_service";
import { AuthMiddleware } from "../../presentation/middleware/auth.middleware";
import { MCP_RESOURCE_PATH } from "../../presentation/controller/delegated_access/oauth_protected_resource_metadata.controller";
import { AuthPostgresRepository } from "../database/postgres_repository/auth_postgres_repository";
import { ConsentPostgresRepository } from "../database/postgres_repository/delegated_access/consent_postgres_repository";
import { IssuedCredentialPostgresRepository } from "../database/postgres_repository/delegated_access/issued_credential_postgres_repository";
import { CryptoDelegatedSecretService } from "../service/crypto_delegated_secret_service";
import { OAuthCredentialVerifier } from "../service/oauth_credential_verifier";

export class MiddlewareDi {
  #authRepository: AuthRepository;
  #sessionManager: ISessionManager;
  #consentRepository: ConsentRepository;
  #issuedCredentialRepository: IssuedCredentialRepository;
  #delegatedSecretService: DelegatedSecretService;

  constructor() {
    this.#authRepository = new AuthPostgresRepository();
    this.#sessionManager = new SessionManager();
    this.#consentRepository = new ConsentPostgresRepository();
    this.#issuedCredentialRepository = new IssuedCredentialPostgresRepository();
    this.#delegatedSecretService = new CryptoDelegatedSecretService();
  }

  makeAuthMiddleware() {
    return new AuthMiddleware(this.#authRepository, this.#sessionManager);
  }

  /**
   * Verificação da credencial OAuth do `/mcp` (task 13, Decisão
   * Arquitetural 3): montável sem instanciar o grafo de casos de uso de
   * `AuthDi` — a mesma razão de existir de `makeAuthMiddleware()` acima,
   * espelhada aqui para a credencial que autentica o transporte MCP em vez
   * da sessão do app. `src/core/infra/mcp` depende só de
   * `CredentialVerifier`; é este container, não `src/core`, que sabe que a
   * implementação é OAuth.
   */
  makeCredentialVerifier(): CredentialVerifier {
    return new OAuthCredentialVerifier(
      this.#issuedCredentialRepository,
      this.#consentRepository,
      this.#authRepository,
      this.#delegatedSecretService,
      `${apiBaseUrl}${MCP_RESOURCE_PATH}`,
      consentAbsoluteLifetimeMs,
      consentInactivityTtlMs
    );
  }
}
