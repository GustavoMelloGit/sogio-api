import type { Locale } from "../../../core/domain/locale/locale";

export type DisplayPreferences = {
  locale: Locale;
  time_zone: string;
};

/**
 * Open Host Service de `auth` — mesmo papel de `EntitlementService` em
 * `billing`: publica ao resto da aplicação o idioma e o fuso que um usuário
 * escolheu, sem expor a entidade `User` nem o repositório. Consumido por
 * qualquer BC que precise escrever um texto endereçado a alguém e não tenha
 * o `User` em mãos.
 */
export interface DisplayPreferencesService {
  preferencesOf(user_id: string): Promise<DisplayPreferences>;
}
