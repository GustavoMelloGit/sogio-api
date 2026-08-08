import type { AuthRepository } from "../../domain/repository/auth_repository";
import { AuthMiddleware } from "../../presentation/middleware/auth.middleware";
import { AuthPostgresRepository } from "../database/postgres_repository/auth_postgres_repository";
import {
  SessionManager,
  type ISessionManager,
} from "../../application/service/session_manager";

export class MiddlewareDi {
  #authRepository: AuthRepository;
  #sessionManager: ISessionManager;

  constructor() {
    this.#authRepository = new AuthPostgresRepository();
    this.#sessionManager = new SessionManager();
  }

  makeAuthMiddleware() {
    return new AuthMiddleware(this.#authRepository, this.#sessionManager);
  }

  makeAuthRepository() {
    return this.#authRepository;
  }

  makeSessionManager() {
    return this.#sessionManager;
  }
}
