import { UnauthorizedError } from "../../../core/application/error/unauthorized_error";
import {
  sessionAbsoluteTtlMs,
  sessionInactivityTtlMs,
} from "../../../core/infra/config/environments";
import { Session } from "../../domain/entity/session";
import type { SessionRepository } from "../../domain/repository/session_repository";
import type { DelegatedSecretService } from "../../domain/service/delegated_secret_service";

export type VerifiedSession = {
  userId: string;
  sessionId: string;
};

export interface ISessionManager {
  createSession(userId: string): Promise<string>;
  verifySession(secret: string): Promise<VerifiedSession>;
  revokeSession(secret: string): Promise<void>;
  revokeAllForUser(userId: string, exceptSecret?: string): Promise<void>;
}

const TOUCH_THROTTLE_MS = 5 * 60 * 1000;

export class SessionManager implements ISessionManager {
  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly secretService: DelegatedSecretService
  ) {}

  async createSession(userId: string): Promise<string> {
    const { secret, digest } = this.secretService.generate();
    const now = new Date();

    await this.sessionRepository.create(
      Session.create({
        user_id: userId,
        secret_digest: digest,
        expires_at: new Date(now.getTime() + sessionAbsoluteTtlMs),
        last_used_at: now,
      })
    );

    return secret;
  }

  async verifySession(secret: string): Promise<VerifiedSession> {
    const session = await this.sessionRepository.findBySecretDigest(
      this.secretService.digest(secret)
    );

    const now = new Date();

    if (!session || !session.isValid(now, sessionInactivityTtlMs)) {
      throw new UnauthorizedError("Unauthorized");
    }

    if (now.getTime() - session.last_used_at.getTime() > TOUCH_THROTTLE_MS) {
      await this.sessionRepository.touch(session.id, now);
    }

    return { userId: session.user_id, sessionId: session.id };
  }

  async revokeSession(secret: string): Promise<void> {
    await this.sessionRepository.revokeBySecretDigest(
      this.secretService.digest(secret)
    );
  }

  async revokeAllForUser(userId: string, exceptSecret?: string): Promise<void> {
    const current = exceptSecret
      ? await this.sessionRepository.findBySecretDigest(
          this.secretService.digest(exceptSecret)
        )
      : null;

    await this.sessionRepository.revokeAllForUser(userId, current?.id);
  }
}
