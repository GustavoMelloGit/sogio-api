import { type Hasher } from "../../application/service/hasher";
import {
  SessionManager,
  type ISessionManager,
} from "../../application/service/session_manager";
import { RegisterUserUseCase } from "../../application/use_case/register_user";
import { SignInUseCase } from "../../application/use_case/sign_in";
import { PurgeUserDataUseCase } from "../../application/use_case/purge_user_data";
import { RegisterAppUseCase } from "../../application/use_case/register_app";
import { InitiateAuthorizationUseCase } from "../../application/use_case/initiate_authorization";
import { GetPendingAuthorizationRequestUseCase } from "../../application/use_case/get_pending_authorization_request";
import { DecideAuthorizationRequestUseCase } from "../../application/use_case/decide_authorization_request";
import { GetUserController } from "../../presentation/controller/auth/get_user.controller";
import { RegisterUserController } from "../../presentation/controller/auth/register_user.controller";
import { SignInController } from "../../presentation/controller/auth/sign_in.controller";
import { PurgeUserDataController } from "../../presentation/controller/auth/purge_user_data.controller";
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
import type { DelegatedSecretService } from "../../domain/service/delegated_secret_service";
import { CryptoDelegatedSecretService } from "../service/crypto_delegated_secret_service";
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
import { AuthMiddleware } from "../../presentation/middleware/auth.middleware";
import type { Logger } from "../../../core/application/logger/logger";
import { CoreDi } from "../../../core/infra/di/core_di";

export class AuthDi {
  #authRepository: AuthRepository;
  #hasher: Hasher;
  #sessionManager: ISessionManager;
  #appRegistrationRepository: AppRegistrationRepository;
  #authorizationRequestRepository: AuthorizationRequestRepository;
  #consentRepository: ConsentRepository;
  #authorizationCodeRepository: AuthorizationCodeRepository;
  #delegatedSecretService: DelegatedSecretService;
  #logger: Logger;

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
    this.#delegatedSecretService = new CryptoDelegatedSecretService();
    this.#logger = new CoreDi().makeLogger();
  }

  // Use Cases
  makeRegisterUserUseCase() {
    return new RegisterUserUseCase(
      this.#authRepository,
      this.#hasher,
      this.#sessionManager
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

  makePurgeUserDataUseCase() {
    return new PurgeUserDataUseCase(this.#authRepository);
  }

  makePurgeUserDataController() {
    return new PurgeUserDataController(this.makePurgeUserDataUseCase());
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
      this.#delegatedSecretService
    );
  }

  makeGetPendingAuthorizationRequestController() {
    return new GetPendingAuthorizationRequestController(
      this.makeGetPendingAuthorizationRequestUseCase(),
      this.makeAuthMiddleware()
    );
  }

  makeDecideAuthorizationRequestUseCase() {
    return new DecideAuthorizationRequestUseCase(
      this.#authorizationRequestRepository,
      this.#appRegistrationRepository,
      this.#consentRepository,
      this.#authorizationCodeRepository,
      this.#delegatedSecretService
    );
  }

  makeDecideAuthorizationRequestController() {
    return new DecideAuthorizationRequestController(
      this.makeDecideAuthorizationRequestUseCase(),
      this.#logger
    );
  }
}
