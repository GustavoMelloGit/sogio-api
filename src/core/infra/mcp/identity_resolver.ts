import type { ISessionManager } from "../../../auth/application/service/session_manager";
import type { User } from "../../../auth/domain/entity/user";
import type { AuthRepository } from "../../../auth/domain/repository/auth_repository";
import { UnauthorizedError } from "../../application/error/unauthorized_error";

export class McpIdentityResolver {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly sessionManager: ISessionManager
  ) {}

  async resolveUser(authorizationHeader: string | undefined): Promise<User> {
    const token = authorizationHeader?.split(" ")[1];

    if (!token) {
      throw new UnauthorizedError("Unauthorized");
    }

    const { userId } = await this.sessionManager.verifySession(token);

    const user = await this.authRepository.findUserById(userId);

    if (!user) {
      throw new UnauthorizedError("Unauthorized");
    }

    return user;
  }
}
