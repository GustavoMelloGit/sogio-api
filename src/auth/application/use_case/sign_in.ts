import type { AuthRepository } from "../../domain/repository/auth_repository";
import { UnauthorizedError } from "../../../core/application/error/unauthorized_error";
import type { Hasher } from "../service/hasher";
import type { ISessionManager } from "../service/session_manager";
import type { UseCase } from "../../../core/application/use_case/use_case";

type Input = {
  email: string;
  password: string;
};

type Output = {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    created_at: Date;
    updated_at: Date;
  };
};

export class SignInUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly hasher: Hasher,
    private readonly sessionManager: ISessionManager
  ) {}

  async execute(input: Input): Promise<Output> {
    const user = await this.authRepository.findUserByEmail(input.email);

    if (!user) {
      throw new UnauthorizedError("Incorrect e-mail or password");
    }

    const isPasswordValid = await this.hasher.compare(
      input.password,
      user.password
    );

    if (!isPasswordValid) {
      throw new UnauthorizedError("Incorrect e-mail or password");
    }

    const token = await this.sessionManager.createSession(user.id);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    };
  }
}
