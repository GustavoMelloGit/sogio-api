import type { AuthRepository } from "../../domain/repository/auth_repository";
import type { PasswordResetRequestRepository } from "../../domain/repository/password_reset_request_repository";
import type { DelegatedSecretService } from "../../domain/service/delegated_secret_service";
import { UnauthorizedError } from "../../../core/application/error/unauthorized_error";
import type { Hasher } from "../service/hasher";
import type { UseCase } from "../../../core/application/use_case/use_case";

type Input = {
  token: string;
  newPassword: string;
};

/**
 * R9 — não distingue "inexistente" de "já usado" de "expirado": as três
 * situações respondem com a mesma mensagem genérica.
 */
const INVALID_TOKEN_MESSAGE = "Invalid or expired password reset token";

/**
 * Redefinição de senha via token de recuperação (DP2: **não** cascateia
 * revogação de consentimentos OAuth/MCP — decisão de produto confirmada,
 * diferente da recomendação original do plano).
 */
export class ResetPasswordUseCase implements UseCase<Input, void> {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly passwordResetRequestRepository: PasswordResetRequestRepository,
    private readonly secretService: DelegatedSecretService,
    private readonly hasher: Hasher
  ) {}

  async execute(input: Input): Promise<void> {
    const digest = this.secretService.digest(input.token);
    const claimed = await this.passwordResetRequestRepository.claim(digest);

    if (!claimed || claimed.expires_at.getTime() <= Date.now()) {
      throw new UnauthorizedError(INVALID_TOKEN_MESSAGE);
    }

    const user = await this.authRepository.findUserById(claimed.user_id);

    if (!user) {
      throw new UnauthorizedError(INVALID_TOKEN_MESSAGE);
    }

    const newPasswordHash = await this.hasher.hash(input.newPassword);
    user.changePassword(newPasswordHash);
    await this.authRepository.updatePassword(user.id, user.password);
  }
}
