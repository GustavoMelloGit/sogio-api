import type { UseCase } from "../../../core/application/use_case/use_case";
import type { ISessionManager } from "../service/session_manager";

type Input = {
  secret: string;
};

export class SignOutUseCase implements UseCase<Input, void> {
  constructor(private readonly sessionManager: ISessionManager) {}

  async execute(input: Input): Promise<void> {
    await this.sessionManager.revokeSession(input.secret);
  }
}
