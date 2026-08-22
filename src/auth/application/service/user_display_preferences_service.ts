import {
  DEFAULT_LOCALE,
  DEFAULT_TIME_ZONE,
} from "../../../core/domain/locale/locale";
import type { AuthRepository } from "../../domain/repository/auth_repository";
import type {
  DisplayPreferences,
  DisplayPreferencesService,
} from "./display_preferences_service";

const DEFAULTS: DisplayPreferences = {
  locale: DEFAULT_LOCALE,
  time_zone: DEFAULT_TIME_ZONE,
};

export class UserDisplayPreferencesService
  implements DisplayPreferencesService
{
  constructor(private readonly authRepository: AuthRepository) {}

  /**
   * Usuário ausente cai no padrão em vez de lançar: quem consome isto está
   * compondo texto, e um texto no idioma padrão é degradação — uma exceção
   * derrubaria a operação de negócio que só queria uma descrição legível.
   */
  async preferencesOf(user_id: string): Promise<DisplayPreferences> {
    const user = await this.authRepository.findUserById(user_id);

    if (!user) {
      return DEFAULTS;
    }

    return { locale: user.locale, time_zone: user.time_zone };
  }
}
