import type { UseCase } from "../../../core/application/use_case/use_case";
import {
  SUPPORTED_LOCALES,
  type Locale,
} from "../../../core/domain/locale/locale";
import type { User } from "../../domain/entity/user";

type Output = {
  locale: Locale;
  time_zone: string;
  supported_locales: readonly Locale[];
};

export class GetUserPreferencesUseCase implements UseCase<void, Output> {
  async execute(_input: void, user: User): Promise<Output> {
    return {
      locale: user.locale,
      time_zone: user.time_zone,
      supported_locales: SUPPORTED_LOCALES,
    };
  }
}
