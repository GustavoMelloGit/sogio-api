import { User } from "../../domain/entity/user";
import { UserCreatedEvent } from "../../domain/event/user_created_event";
import type { AuthRepository } from "../../domain/repository/auth_repository";
import { ConflictError } from "../../../core/application/error/conflict_error";
import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import type { Hasher } from "../service/hasher";
import type { ISessionManager } from "../service/session_manager";
import type { UseCase } from "../../../core/application/use_case/use_case";

type Input = {
  name: string;
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

export class RegisterUserUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly userRepository: AuthRepository,
    private readonly hasher: Hasher,
    private readonly sessionManager: ISessionManager,
    private readonly eventDispatcher: EventDispatcher
  ) {}

  async execute(input: Input): Promise<Output> {
    const existingUser = await this.userRepository.findUserByEmail(input.email);

    if (existingUser) {
      throw new ConflictError("User already exists");
    }

    const hashedPassword = await this.hasher.hash(input.password);

    const user = User.create({
      name: input.name,
      email: input.email,
      password: hashedPassword,
    });

    const savedUser = await this.userRepository.addUser(user);

    await this.eventDispatcher.dispatch(new UserCreatedEvent(savedUser.id));

    const token = await this.sessionManager.createSession(
      savedUser.id,
      savedUser.role
    );

    return {
      token,
      user: {
        id: savedUser.id,
        name: savedUser.name,
        email: savedUser.email,
        role: savedUser.role,
        created_at: savedUser.created_at,
        updated_at: savedUser.updated_at,
      },
    };
  }
}
