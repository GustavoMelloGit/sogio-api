import type { User } from "../../domain/entity/user";
import type { AuthRepository } from "../../domain/repository/auth_repository";
import { ConflictError } from "../../../core/application/error/conflict_error";
import { UnauthorizedError } from "../../../core/application/error/unauthorized_error";
import { ValidationError } from "../../../core/application/error/validation_error";
import type { Hasher } from "../service/hasher";
import type { ISessionManager } from "../service/session_manager";
import type { UseCase } from "../../../core/application/use_case/use_case";

type Input = {
  currentPassword: string;
  newPassword: string;
  currentSessionSecret?: string;
};

export const NO_PASSWORD_MESSAGE =
  "This account has no password yet. Use password recovery to set one.";

/**
 * Troca de senha autenticada (R10/R12). `user` já foi carregado por
 * `AuthMiddleware` nesta mesma requisição — não há necessidade de
 * recarregá-lo. Sem limite de uso: quem já provou a senha atual não precisa
 * de rate limiting adicional além do `peer-ip` padrão da rota.
 */
export class ChangePasswordUseCase implements UseCase<Input, void> {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly hasher: Hasher,
    private readonly sessionManager: ISessionManager
  ) {}

  async execute(input: Input, user: User): Promise<void> {
    const currentPasswordHash = user.password;

    if (currentPasswordHash === null) {
      throw new ConflictError(NO_PASSWORD_MESSAGE);
    }

    const isCurrentPasswordValid = await this.hasher.compare(
      input.currentPassword,
      currentPasswordHash
    );

    if (!isCurrentPasswordValid) {
      throw new UnauthorizedError("Incorrect current password");
    }

    const isSamePassword = await this.hasher.compare(
      input.newPassword,
      currentPasswordHash
    );

    if (isSamePassword) {
      throw new ValidationError(
        "New password must be different from the current password"
      );
    }

    const newPasswordHash = await this.hasher.hash(input.newPassword);
    user.changePassword(newPasswordHash);
    await this.authRepository.updatePassword(user.id, newPasswordHash);

    await this.sessionManager.revokeAllForUser(
      user.id,
      input.currentSessionSecret
    );
  }
}
