import type { User } from "../../domain/entity/user";
import type { AuthRepository } from "../../domain/repository/auth_repository";
import { UnauthorizedError } from "../../../core/application/error/unauthorized_error";
import { ValidationError } from "../../../core/application/error/validation_error";
import type { Hasher } from "../service/hasher";
import type { UseCase } from "../../../core/application/use_case/use_case";

type Input = {
  currentPassword: string;
  newPassword: string;
};

/**
 * Troca de senha autenticada (R10/R12). `user` já foi carregado por
 * `AuthMiddleware` nesta mesma requisição — não há necessidade de
 * recarregá-lo. Sem limite de uso: quem já provou a senha atual não precisa
 * de rate limiting adicional além do `peer-ip` padrão da rota.
 */
export class ChangePasswordUseCase implements UseCase<Input, void> {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly hasher: Hasher
  ) {}

  async execute(input: Input, user: User): Promise<void> {
    const isCurrentPasswordValid = await this.hasher.compare(
      input.currentPassword,
      user.password
    );

    if (!isCurrentPasswordValid) {
      throw new UnauthorizedError("Incorrect current password");
    }

    const isSamePassword = await this.hasher.compare(
      input.newPassword,
      user.password
    );

    if (isSamePassword) {
      throw new ValidationError(
        "New password must be different from the current password"
      );
    }

    const newPasswordHash = await this.hasher.hash(input.newPassword);
    user.changePassword(newPasswordHash);
    await this.authRepository.updatePassword(user.id, user.password);
  }
}
