import type { Locale } from "../../../core/domain/locale/locale";
import type { User } from "../entity/user";

export type UserPreferences = {
  locale: Locale;
  time_zone: string;
};

export interface AuthRepository {
  addUser(input: User): Promise<User>;
  findUserById(id: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<User | null>;
  purgeUserData(userId: string): Promise<void>;
  /** Restrito à senha (Interface Segregation) — evita que uma persistência genérica vire vetor de mass assignment sobre `role`. */
  updatePassword(userId: string, passwordHash: string): Promise<void>;
  /** Restrito às preferências de exibição, pelo mesmo motivo de `updatePassword`. */
  updatePreferences(
    userId: string,
    preferences: UserPreferences
  ): Promise<void>;
}
