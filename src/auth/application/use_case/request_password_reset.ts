import { PasswordResetRequest } from "../../domain/entity/password_reset_request";
import type { AuthRepository } from "../../domain/repository/auth_repository";
import type { PasswordResetRequestRepository } from "../../domain/repository/password_reset_request_repository";
import type { DelegatedSecretService } from "../../domain/service/delegated_secret_service";
import {
  isPasswordResetQuotaExceeded,
  passwordResetQuotaWindowStart,
} from "../../domain/service/password_reset_quota_policy";
import { composePasswordResetEmail } from "../service/password_reset_email_composer";
import type { EmailService } from "../../../core/application/email/email_service";
import type { Logger } from "../../../core/application/logger/logger";
import type { UseCase } from "../../../core/application/use_case/use_case";

type Input = {
  email: string;
};

type Output = {
  message: string;
};

/**
 * D11 — esta resposta é **sempre** a mesma, aconteça o que acontecer: email
 * inexistente (R1), cota estourada (R2) ou falha no envio (R15) nunca são
 * distinguíveis do caminho feliz. Qualquer sinal de diagnóstico vai para o
 * `Logger`, nunca para o retorno.
 */
const GENERIC_OUTPUT: Output = {
  message:
    "If an account exists for this email, a password reset link has been sent.",
};

export class RequestPasswordResetUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly passwordResetRequestRepository: PasswordResetRequestRepository,
    private readonly secretService: DelegatedSecretService,
    private readonly emailService: EmailService,
    private readonly logger: Logger,
    private readonly requestTtlMs: number,
    private readonly frontBaseUrl: string
  ) {}

  async execute(input: Input): Promise<Output> {
    const user = await this.authRepository.findUserByEmail(input.email);

    if (!user) {
      return GENERIC_OUTPUT;
    }

    const requestsInWindow =
      await this.passwordResetRequestRepository.countByUserSince(
        user.id,
        passwordResetQuotaWindowStart()
      );

    if (isPasswordResetQuotaExceeded(requestsInWindow)) {
      this.logger.warn("Password reset quota exceeded", {
        endpoint: "request_password_reset",
      });
      return GENERIC_OUTPUT;
    }

    await this.passwordResetRequestRepository.invalidatePendingByUser(user.id);

    const { secret, digest } = this.secretService.generate();

    const passwordResetRequest = PasswordResetRequest.create({
      user_id: user.id,
      token_digest: digest,
      expires_at: new Date(Date.now() + this.requestTtlMs),
    });

    await this.passwordResetRequestRepository.create(passwordResetRequest);

    const message = composePasswordResetEmail(
      this.frontBaseUrl,
      user.email,
      secret
    );

    try {
      await this.emailService.send(message);
    } catch {
      this.logger.error("Failed to send password reset email", {
        endpoint: "request_password_reset",
      });
    }

    await this.#purgeExpiredRequests();

    return GENERIC_OUTPUT;
  }

  /**
   * Expurgo best-effort (R14), piggyback na própria rota — o projeto não tem
   * cron, mesmo padrão de `RegisterAppUseCase.#purgeUnusedRegistrations`.
   */
  async #purgeExpiredRequests(): Promise<void> {
    try {
      await this.passwordResetRequestRepository.deleteExpired(new Date());
    } catch {
      this.logger.error("Failed to purge expired password reset requests", {
        endpoint: "request_password_reset",
      });
    }
  }
}
