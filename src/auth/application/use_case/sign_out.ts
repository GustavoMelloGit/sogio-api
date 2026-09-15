import type { UseCase } from "../../../core/application/use_case/use_case";
import type { ISessionManager } from "../service/session_manager";

type Input = {
  /** Segredo da sessão que está encerrando. */
  secret: string;
};

/**
 * Logout de verdade: encerra a sessão no servidor, em vez de apenas apagar a
 * credencial do navegador. Enquanto a sessão era um JWT stateless, "sair" só
 * limpava o `localStorage` e o token continuava valendo para quem o tivesse
 * copiado.
 *
 * Encerrar uma sessão que já não existe é sucesso: o resultado pedido —
 * "esta credencial não vale mais" — já está valendo, e distinguir os dois
 * casos só entregaria a um atacante a informação de qual segredo existe.
 */
export class SignOutUseCase implements UseCase<Input, void> {
  constructor(private readonly sessionManager: ISessionManager) {}

  async execute(input: Input): Promise<void> {
    await this.sessionManager.revokeSession(input.secret);
  }
}
