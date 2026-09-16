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

/**
 * Registrar o uso a cada requisição dobraria a escrita do endpoint mais
 * quente. Com esta folga, uma sessão em uso contínuo grava no máximo uma vez
 * a cada cinco minutos, e a expiração por inatividade continua com precisão
 * muito acima do que uma janela de dias exige.
 */
const TOUCH_THROTTLE_MS = 5 * 60 * 1000;

/**
 * Sessão do app: segredo opaco entregue uma vez, digest persistido.
 *
 * Substituiu um JWT stateless de 1 dia. O motivo é revogação: com o JWT era
 * arquitetonicamente impossível derrubar uma sessão existente ao trocar a
 * senha (R11 em `.claude/plans/2026-08-15-gestao-de-senha.md`). Aqui,
 * encerrar é um `UPDATE`.
 *
 * O mesmo segredo serve ao cookie do navegador e ao `Authorization: Bearer`
 * de quem chama a API direto — é a credencial que muda de transporte, nunca
 * de natureza.
 */
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

  /**
   * Nunca distingue o motivo da recusa — inexistente, expirada, parada ou
   * encerrada saem todas como a mesma `UnauthorizedError`, para não abrir
   * oráculo sobre o estado de uma sessão específica.
   */
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

  /** Logout: encerrar uma sessão inexistente é sucesso, não erro. */
  async revokeSession(secret: string): Promise<void> {
    await this.sessionRepository.revokeBySecretDigest(
      this.secretService.digest(secret)
    );
  }

  /**
   * `exceptSecret` poupa a sessão de quem pediu — é o que faz a troca de
   * senha derrubar os outros aparelhos sem deslogar a própria pessoa no meio
   * da ação.
   */
  async revokeAllForUser(userId: string, exceptSecret?: string): Promise<void> {
    const current = exceptSecret
      ? await this.sessionRepository.findBySecretDigest(
          this.secretService.digest(exceptSecret)
        )
      : null;

    await this.sessionRepository.revokeAllForUser(userId, current?.id);
  }
}
