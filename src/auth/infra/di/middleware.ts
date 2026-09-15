import {
  apiBaseUrl,
  consentAbsoluteLifetimeMs,
  consentInactivityTtlMs,
} from "../../../core/infra/config/environments";
import {
  SessionManager,
  type ISessionManager,
} from "../../application/service/session_manager";
import { LegacyJwtSessionVerifier } from "../../application/service/legacy_jwt_session_verifier";
import { SessionPostgresRepository } from "../database/postgres_repository/session_postgres_repository";
import { ConsentCascade } from "../../application/service/consent_cascade";
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
    this.#delegatedSecretService = new CryptoDelegatedSecretService();
    this.#sessionManager = new SessionManager(
      new SessionPostgresRepository(),
      this.#delegatedSecretService
    );
    this.#consentRepository = new ConsentPostgresRepository();
    this.#issuedCredentialRepository = new IssuedCredentialPostgresRepository();
  }

  makeAuthMiddleware() {
    return new AuthMiddleware(
      this.#authRepository,
      this.#sessionManager,
      new LegacyJwtSessionVerifier()
    );
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
      consentInactivityTtlMs,
      new ConsentCascade(
        this.#consentRepository,
        this.#issuedCredentialRepository
      )
    );
  }
}
