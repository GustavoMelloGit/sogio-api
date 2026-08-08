import { type Hasher } from "../../application/service/hasher";
import {
  SessionManager,
  type ISessionManager,
} from "../../application/service/session_manager";
import { RegisterUserUseCase } from "../../application/use_case/register_user";
import { SignInUseCase } from "../../application/use_case/sign_in";
import { PurgeUserDataUseCase } from "../../application/use_case/purge_user_data";
import { GetUserController } from "../../presentation/controller/auth/get_user.controller";
import { RegisterUserController } from "../../presentation/controller/auth/register_user.controller";
import { SignInController } from "../../presentation/controller/auth/sign_in.controller";
import { PurgeUserDataController } from "../../presentation/controller/auth/purge_user_data.controller";
import { BunHasher } from "../service/bun_hasher";
import type { AuthRepository } from "../../domain/repository/auth_repository";
import { AuthPostgresRepository } from "../database/postgres_repository/auth_postgres_repository";
import {
  OAuthProtectedResourceMetadataController,
  OAUTH_PROTECTED_RESOURCE_METADATA_PATH,
  OAUTH_PROTECTED_RESOURCE_METADATA_PATH_FOR_MCP,
} from "../../presentation/controller/delegated_access/oauth_protected_resource_metadata.controller";
import { OAuthAuthorizationServerMetadataController } from "../../presentation/controller/delegated_access/oauth_authorization_server_metadata.controller";

export class AuthDi {
  #authRepository: AuthRepository;
  #hasher: Hasher;
  #sessionManager: ISessionManager;

  constructor() {
    this.#authRepository = new AuthPostgresRepository();
    this.#hasher = new BunHasher();
    this.#sessionManager = new SessionManager();
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
}
