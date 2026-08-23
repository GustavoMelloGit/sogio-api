import { type Hasher } from "../../application/service/hasher";
import {
  SessionManager,
  type ISessionManager,
} from "../../application/service/session_manager";
import { RegisterUserUseCase } from "../../application/use_case/register_user";
import { SignInUseCase } from "../../application/use_case/sign_in";
import { PurgeUserDataUseCase } from "../../application/use_case/purge_user_data";
import { ChangePasswordUseCase } from "../../application/use_case/change_password";
import { RequestPasswordResetUseCase } from "../../application/use_case/request_password_reset";
import { ResetPasswordUseCase } from "../../application/use_case/reset_password";
import { RegisterAppUseCase } from "../../application/use_case/register_app";
import { InitiateAuthorizationUseCase } from "../../application/use_case/initiate_authorization";
import { GetPendingAuthorizationRequestUseCase } from "../../application/use_case/get_pending_authorization_request";
import { DecideAuthorizationRequestUseCase } from "../../application/use_case/decide_authorization_request";
import { ConsentCascade } from "../../application/service/consent_cascade";
import { GetUserPreferencesUseCase } from "../../application/use_case/get_user_preferences";
import { UpdateUserPreferencesUseCase } from "../../application/use_case/update_user_preferences";
import { GetUserPreferencesController } from "../../presentation/controller/auth/get_user_preferences.controller";
import { UpdateUserPreferencesController } from "../../presentation/controller/auth/update_user_preferences.controller";
import { makeGetUserPreferencesTool } from "../../presentation/mcp_tool/get_user_preferences.mcp_tool";
import { makeUpdateUserPreferencesTool } from "../../presentation/mcp_tool/update_user_preferences.mcp_tool";
import { GetUserController } from "../../presentation/controller/auth/get_user.controller";
import { RegisterUserController } from "../../presentation/controller/auth/register_user.controller";
import { SignInController } from "../../presentation/controller/auth/sign_in.controller";
import { PurgeUserDataController } from "../../presentation/controller/auth/purge_user_data.controller";
import { ChangePasswordController } from "../../presentation/controller/auth/change_password.controller";
import { RequestPasswordResetController } from "../../presentation/controller/auth/request_password_reset.controller";
import { ResetPasswordController } from "../../presentation/controller/auth/reset_password.controller";
import { BunHasher } from "../service/bun_hasher";
import type { AuthRepository } from "../../domain/repository/auth_repository";
import { AuthPostgresRepository } from "../database/postgres_repository/auth_postgres_repository";
import type { AppRegistrationRepository } from "../../domain/repository/delegated_access/app_registration_repository";
import { AppRegistrationPostgresRepository } from "../database/postgres_repository/delegated_access/app_registration_postgres_repository";
import type { AuthorizationRequestRepository } from "../../domain/repository/delegated_access/authorization_request_repository";
import { AuthorizationRequestPostgresRepository } from "../database/postgres_repository/delegated_access/authorization_request_postgres_repository";
import type { ConsentRepository } from "../../domain/repository/delegated_access/consent_repository";
import { ConsentPostgresRepository } from "../database/postgres_repository/delegated_access/consent_postgres_repository";
import type { AuthorizationCodeRepository } from "../../domain/repository/delegated_access/authorization_code_repository";
import { AuthorizationCodePostgresRepository } from "../database/postgres_repository/delegated_access/authorization_code_postgres_repository";
import type { IssuedCredentialRepository } from "../../domain/repository/delegated_access/issued_credential_repository";
import { IssuedCredentialPostgresRepository } from "../database/postgres_repository/delegated_access/issued_credential_postgres_repository";
import type { DelegatedSecretService } from "../../domain/service/delegated_secret_service";
import { CryptoDelegatedSecretService } from "../service/crypto_delegated_secret_service";
import type { PasswordResetRequestRepository } from "../../domain/repository/password_reset_request_repository";
import { PasswordResetRequestPostgresRepository } from "../database/postgres_repository/password_reset_request_postgres_repository";
import type { RefreshRotationGraceCache } from "../../domain/service/refresh_rotation_grace_cache";
import { InMemoryRefreshRotationGraceCache } from "../service/in_memory_refresh_rotation_grace_cache";
import { ExchangeAuthorizationCodeUseCase } from "../../application/use_case/exchange_authorization_code";
import { RefreshAccessTokenUseCase } from "../../application/use_case/refresh_access_token";
import { RevokeTokenUseCase } from "../../application/use_case/revoke_token";
import { RevokeConsentUseCase } from "../../application/use_case/revoke_consent";
import { ListConnectedAppsUseCase } from "../../application/use_case/list_connected_apps";
import { TokenController } from "../../presentation/controller/delegated_access/token.controller";
import { RevokeController } from "../../presentation/controller/delegated_access/revoke.controller";
import {
  OAuthProtectedResourceMetadataController,
  OAUTH_PROTECTED_RESOURCE_METADATA_PATH,
  OAUTH_PROTECTED_RESOURCE_METADATA_PATH_FOR_MCP,
} from "../../presentation/controller/delegated_access/oauth_protected_resource_metadata.controller";
import { OAuthAuthorizationServerMetadataController } from "../../presentation/controller/delegated_access/oauth_authorization_server_metadata.controller";
import { RegisterAppController } from "../../presentation/controller/delegated_access/register_app.controller";
import { AuthorizeController } from "../../presentation/controller/delegated_access/authorize.controller";
import { GetPendingAuthorizationRequestController } from "../../presentation/controller/delegated_access/get_pending_authorization_request.controller";
import { DecideAuthorizationRequestController } from "../../presentation/controller/delegated_access/decide_authorization_request.controller";
import { ListConnectedAppsController } from "../../presentation/controller/delegated_access/list_connected_apps.controller";
import { DisconnectAppController } from "../../presentation/controller/delegated_access/disconnect_app.controller";
import { AuthMiddleware } from "../../presentation/middleware/auth.middleware";
import type { Logger } from "../../../core/application/logger/logger";
import type { RateLimiter } from "../../../core/application/rate_limit/rate_limiter";
import type { EmailService } from "../../../core/application/email/email_service";
import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import { inMemoryEventDispatcher } from "../../../core/infra/event/in_memory_event_dispatcher";
import { CoreDi } from "../../../core/infra/di/core_di";
import {
  accessTokenTtlMs,
  refreshTokenTtlMs,
  refreshRotationGraceWindowMs,
  consentAbsoluteLifetimeMs,
  consentInactivityTtlMs,
  passwordResetRequestTtlMs,
  frontBaseUrl,
} from "../../../core/infra/config/environments";

export class AuthDi {
  #authRepository: AuthRepository;
  #hasher: Hasher;
  #sessionManager: ISessionManager;
  #appRegistrationRepository: AppRegistrationRepository;
  #authorizationRequestRepository: AuthorizationRequestRepository;
  #consentRepository: ConsentRepository;
  #authorizationCodeRepository: AuthorizationCodeRepository;
  #issuedCredentialRepository: IssuedCredentialRepository;
  #delegatedSecretService: DelegatedSecretService;
  #refreshRotationGraceCache: RefreshRotationGraceCache;
  #logger: Logger;
  #rateLimiter: RateLimiter;
  #emailService: EmailService;
  #passwordResetRequestRepository: PasswordResetRequestRepository;
  #eventDispatcher: EventDispatcher;

  constructor() {
    this.#authRepository = new AuthPostgresRepository();
    this.#hasher = new BunHasher();
    this.#sessionManager = new SessionManager();
    this.#appRegistrationRepository = new AppRegistrationPostgresRepository();
    this.#authorizationRequestRepository =
      new AuthorizationRequestPostgresRepository();
    this.#consentRepository = new ConsentPostgresRepository();
    this.#authorizationCodeRepository =
      new AuthorizationCodePostgresRepository();
    this.#issuedCredentialRepository = new IssuedCredentialPostgresRepository();
    this.#delegatedSecretService = new CryptoDelegatedSecretService();
    this.#refreshRotationGraceCache = new InMemoryRefreshRotationGraceCache();
    this.#passwordResetRequestRepository =
      new PasswordResetRequestPostgresRepository();
    const coreDi = new CoreDi();
    this.#logger = coreDi.makeLogger();
    this.#rateLimiter = coreDi.makeRateLimiter();
    this.#emailService = coreDi.makeEmailService();
    this.#eventDispatcher = inMemoryEventDispatcher;
  }

  // Use Cases
  makeRegisterUserUseCase() {
    return new RegisterUserUseCase(
      this.#authRepository,
      this.#hasher,
      this.#sessionManager,
      this.#eventDispatcher
    );
  }

  makeSignInUseCase() {
    return new SignInUseCase(
      this.#authRepository,
      this.#hasher,
      this.#sessionManager
    );
  }

  // Controllers
  makeRegisterUserController() {
    return new RegisterUserController(this.makeRegisterUserUseCase());
  }
  makeSignInController() {
    return new SignInController(this.makeSignInUseCase());
  }
  makeGetUserController() {
    return new GetUserController();
  }

  makeGetUserPreferencesUseCase() {
    return new GetUserPreferencesUseCase();
  }

  makeUpdateUserPreferencesUseCase() {
    return new UpdateUserPreferencesUseCase(this.#authRepository);
  }

  makeGetUserPreferencesController() {
    return new GetUserPreferencesController(
      this.makeGetUserPreferencesUseCase()
    );
  }

  makeUpdateUserPreferencesController() {
    return new UpdateUserPreferencesController(
      this.makeUpdateUserPreferencesUseCase()
    );
  }

  makeGetUserPreferencesTool() {
    return makeGetUserPreferencesTool(this.makeGetUserPreferencesUseCase());
  }

  makeUpdateUserPreferencesTool() {
    return makeUpdateUserPreferencesTool(
      this.makeUpdateUserPreferencesUseCase()
    );
  }

  makePurgeUserDataUseCase() {
    return new PurgeUserDataUseCase(this.#authRepository);
  }

  makePurgeUserDataController() {
    return new PurgeUserDataController(this.makePurgeUserDataUseCase());
  }

  // Password management (change + email-based recovery)
  makeChangePasswordUseCase() {
    return new ChangePasswordUseCase(this.#authRepository, this.#hasher);
  }

  makeChangePasswordController() {
    return new ChangePasswordController(this.makeChangePasswordUseCase());
  }

  makeRequestPasswordResetUseCase() {
    return new RequestPasswordResetUseCase(
      this.#authRepository,
      this.#passwordResetRequestRepository,
      this.#delegatedSecretService,
      this.#emailService,
      this.#logger,
      passwordResetRequestTtlMs,
      frontBaseUrl
    );
  }

  makeRequestPasswordResetController() {
    return new RequestPasswordResetController(
      this.makeRequestPasswordResetUseCase()
    );
  }

  makeResetPasswordUseCase() {
    return new ResetPasswordUseCase(
      this.#authRepository,
      this.#passwordResetRequestRepository,
      this.#delegatedSecretService,
      this.#hasher
    );
  }

  makeResetPasswordController() {
    return new ResetPasswordController(this.makeResetPasswordUseCase());
  }

  // Discovery (RFC 9728 / RFC 8414)
  makeOAuthProtectedResourceMetadataController() {
    return new OAuthProtectedResourceMetadataController(
      OAUTH_PROTECTED_RESOURCE_METADATA_PATH
    );
  }

  makeOAuthProtectedResourceMetadataForMcpController() {
    return new OAuthProtectedResourceMetadataController(
      OAUTH_PROTECTED_RESOURCE_METADATA_PATH_FOR_MCP
    );
  }

  makeOAuthAuthorizationServerMetadataController() {
    return new OAuthAuthorizationServerMetadataController();
  }

  // Delegated Access — dynamic client registration (RFC 7591, task 8)
  makeRegisterAppUseCase() {
    return new RegisterAppUseCase(
      this.#appRegistrationRepository,
      this.#logger
    );
  }

  makeRegisterAppController() {
    return new RegisterAppController(this.makeRegisterAppUseCase());
  }

  // Delegated Access — start of authorization, E2's ordered validation (task 9)
  makeInitiateAuthorizationUseCase() {
    return new InitiateAuthorizationUseCase(
      this.#appRegistrationRepository,
      this.#authorizationRequestRepository,
      this.#delegatedSecretService
    );
  }

  makeAuthorizeController() {
    return new AuthorizeController(
      this.makeInitiateAuthorizationUseCase(),
      this.#logger
    );
  }

  /**
   * Mirrors `MiddlewareDi.makeAuthMiddleware()` — a second, independently
   * wired instance, by the same design already established between
   * `AuthDi` and `MiddlewareDi` (Decisão Arquitetural #3): this container
   * has to be assemblable without the rest of the app's use-case graph, so
   * it builds its own `AuthMiddleware` from the dependencies it already
   * holds rather than reaching into the other container.
   */
  makeAuthMiddleware() {
    return new AuthMiddleware(this.#authRepository, this.#sessionManager);
  }

  // Delegated Access — pending request consult and decision (task 10)
  makeGetPendingAuthorizationRequestUseCase() {
    return new GetPendingAuthorizationRequestUseCase(
      this.#authorizationRequestRepository,
      this.#appRegistrationRepository,
      this.#consentRepository,
      this.#delegatedSecretService,
      consentAbsoluteLifetimeMs,
      consentInactivityTtlMs
    );
  }

  makeGetPendingAuthorizationRequestController() {
    return new GetPendingAuthorizationRequestController(
      this.makeGetPendingAuthorizationRequestUseCase(),
      this.makeAuthMiddleware()
    );
  }

  makeConsentCascade() {
    return new ConsentCascade(
      this.#consentRepository,
      this.#issuedCredentialRepository
    );
  }

  makeDecideAuthorizationRequestUseCase() {
    return new DecideAuthorizationRequestUseCase(
      this.#authorizationRequestRepository,
      this.#appRegistrationRepository,
      this.#consentRepository,
      this.#authorizationCodeRepository,
      this.#issuedCredentialRepository,
      this.#delegatedSecretService,
      consentAbsoluteLifetimeMs,
      consentInactivityTtlMs,
      this.makeConsentCascade()
    );
  }

  makeDecideAuthorizationRequestController() {
    return new DecideAuthorizationRequestController(
      this.makeDecideAuthorizationRequestUseCase(),
      this.#logger
    );
  }

  // Delegated Access — token issuance and refresh rotation (task 11)
  makeExchangeAuthorizationCodeUseCase() {
    return new ExchangeAuthorizationCodeUseCase(
      this.#authorizationCodeRepository,
      this.#issuedCredentialRepository,
      this.#consentRepository,
      this.#delegatedSecretService,
      accessTokenTtlMs,
      refreshTokenTtlMs,
      refreshRotationGraceWindowMs,
      consentAbsoluteLifetimeMs,
      consentInactivityTtlMs,
      this.makeConsentCascade()
    );
  }

  makeRefreshAccessTokenUseCase() {
    return new RefreshAccessTokenUseCase(
      this.#issuedCredentialRepository,
      this.#consentRepository,
      this.#delegatedSecretService,
      this.#refreshRotationGraceCache,
      accessTokenTtlMs,
      refreshTokenTtlMs,
      refreshRotationGraceWindowMs,
      consentAbsoluteLifetimeMs,
      consentInactivityTtlMs,
      this.makeConsentCascade()
    );
  }

  makeTokenController() {
    return new TokenController(
      this.makeExchangeAuthorizationCodeUseCase(),
      this.makeRefreshAccessTokenUseCase(),
      this.#appRegistrationRepository,
      this.#rateLimiter,
      this.#logger
    );
  }

  // Delegated Access — protocol revocation, RFC 7009 (task 12)
  makeRevokeTokenUseCase() {
    return new RevokeTokenUseCase(
      this.#issuedCredentialRepository,
      this.#consentRepository,
      this.#delegatedSecretService
    );
  }

  makeRevokeController() {
    return new RevokeController(
      this.makeRevokeTokenUseCase(),
      this.#appRegistrationRepository,
      this.#rateLimiter,
      this.#logger
    );
  }

  /**
   * Consent-cascade revocation mechanism (task 12), consumed directly by
   * `DisconnectAppController` (task 14): authenticated by the app's own
   * session, and the use case itself confirms the consent being
   * disconnected belongs to the requesting user before revoking anything.
   */
  makeRevokeConsentUseCase() {
    return new RevokeConsentUseCase(
      this.#consentRepository,
      this.#issuedCredentialRepository,
      this.makeConsentCascade()
    );
  }

  // Delegated Access — connected apps screen: list and disconnect (task 14)
  makeListConnectedAppsUseCase() {
    return new ListConnectedAppsUseCase(
      this.#consentRepository,
      this.#appRegistrationRepository,
      this.#issuedCredentialRepository,
      this.#authorizationRequestRepository,
      this.#authorizationCodeRepository,
      consentAbsoluteLifetimeMs,
      consentInactivityTtlMs,
      this.#logger,
      this.makeConsentCascade()
    );
  }

  makeListConnectedAppsController() {
    return new ListConnectedAppsController(this.makeListConnectedAppsUseCase());
  }

  /**
   * "Desconectar" reuses `RevokeConsentUseCase` as-is (task 12) — no
   * wrapping use case, since ownership enforcement and the revocation
   * cascade already live there and this task must not reimplement either.
   */
  makeDisconnectAppController() {
    return new DisconnectAppController(this.makeRevokeConsentUseCase());
  }
}
