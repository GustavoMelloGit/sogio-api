import type { UseCase } from "../../../core/application/use_case/use_case";
import type { Locale } from "../../../core/domain/locale/locale";
import type { User } from "../../domain/entity/user";
import type { AuthRepository } from "../../domain/repository/auth_repository";

type Input = {
  locale?: Locale;
  time_zone?: string;
};

type Output = {
  locale: Locale;
  time_zone: string;
};

export class UpdateUserPreferencesUseCase implements UseCase<Input, Output> {
  constructor(private readonly authRepository: AuthRepository) {}

  async execute(input: Input, user: User): Promise<Output> {
    user.changePreferences({
      locale: input.locale ?? user.locale,
      time_zone: input.time_zone ?? user.time_zone,
    });

    await this.authRepository.updatePreferences(user.id, {
      locale: user.locale,
      time_zone: user.time_zone,
    });

    return { locale: user.locale, time_zone: user.time_zone };
  }
}
