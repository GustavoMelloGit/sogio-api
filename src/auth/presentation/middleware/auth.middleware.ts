import { UnauthorizedError } from "../../../core/application/error/unauthorized_error";
import { sessionCookieName } from "../http/session_cookie";
import type { ISessionManager } from "../../application/service/session_manager";
import type { LegacyJwtSessionVerifier } from "../../application/service/legacy_jwt_session_verifier";
import type { User } from "../../domain/entity/user";
import type { AuthRepository } from "../../domain/repository/auth_repository";
import type { ControllerRequest } from "../../../core/presentation/controller/controller";

export type SessionCredential = {
  secret: string;
  source: "header" | "cookie";
};

export class AuthMiddleware {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly sessionManager: ISessionManager,
    private readonly legacyJwtVerifier: LegacyJwtSessionVerifier
  ) {}

  extract(
    request: ControllerRequest,
    allowCookie: boolean
  ): SessionCredential | null {
    const header = request.headers["authorization"];
    const bearer = header?.startsWith("Bearer ")
      ? header.slice("Bearer ".length).trim()
      : undefined;

    if (bearer) {
      return { secret: bearer, source: "header" };
    }

    const cookie = allowCookie
      ? request.cookies[sessionCookieName()]
      : undefined;

    return cookie ? { secret: cookie, source: "cookie" } : null;
  }

  async authenticate(credential: SessionCredential): Promise<User> {
    const resolved = await this.#resolve(credential);
    const user = await this.authRepository.findUserById(resolved.userId);

    if (!user) {
      throw new UnauthorizedError("Unauthorized");
    }

    if (
      resolved.legacyIssuedAt &&
      user.password_changed_at &&
      user.password_changed_at > resolved.legacyIssuedAt
    ) {
      throw new UnauthorizedError("Unauthorized");
    }

    return user;
  }

  async handle(request: ControllerRequest, allowCookie = true): Promise<User> {
    const credential = this.extract(request, allowCookie);

    if (!credential) {
      throw new UnauthorizedError("Unauthorized");
    }

    return this.authenticate(credential);
  }

  /**
   * Same verification as `handle`, for callers where a missing or invalid
   * credential is a legitimate outcome rather than a failure — e.g. the
   * pending authorization request lookup (task 10), which the front may
   * call before the user has logged in, and which only needs to know
   * *whether* a caller is identified, never to reject the request when one
   * isn't.
   */
  async handleOptional(
    request: ControllerRequest,
    allowCookie: boolean
  ): Promise<User | null> {
    try {
      return await this.handle(request, allowCookie);
    } catch {
      return null;
    }
  }

  async #resolve(
    credential: SessionCredential
  ): Promise<{ userId: string; legacyIssuedAt?: Date }> {
    try {
      const { userId } = await this.sessionManager.verifySession(
        credential.secret
      );

      return { userId };
    } catch (error) {
      if (credential.source !== "header") {
        throw error;
      }

      const legacy = this.legacyJwtVerifier.verify(credential.secret);

      if (!legacy) {
        throw error;
      }

      return { userId: legacy.userId, legacyIssuedAt: legacy.issuedAt };
    }
  }
}
