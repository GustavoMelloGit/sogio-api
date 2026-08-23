import type {
  DisplayPreferences,
  DisplayPreferencesService,
} from "../../../auth/application/service/display_preferences_service";
import {
  DEFAULT_LOCALE,
  DEFAULT_TIME_ZONE,
} from "../../../core/domain/locale/locale";
import type { PropertyRepository } from "../../../property_management/domain/repository/property_repository";

const DEFAULTS: DisplayPreferences = {
  locale: DEFAULT_LOCALE,
  time_zone: DEFAULT_TIME_ZONE,
};

/**
 * A descrição de um lançamento é escrita para o dono do imóvel, mas os
 * eventos de estadia carregam a propriedade, não o dono. Esta é a travessia
 * dos dois passos — imóvel → dono, dono → preferências —, mantida fora dos
 * handlers para que ambos vejam uma dependência só.
 *
 * `propertyOfId` deliberadamente não filtra `deleted_at`, o que é o que faz
 * este caminho funcionar durante a exclusão em cascata de uma propriedade —
 * é exatamente quando `RevertRevenueOnStayCancel` roda.
 */
export class StayLedgerPreferences {
  constructor(
    private readonly propertyRepository: PropertyRepository,
    private readonly displayPreferencesService: DisplayPreferencesService
  ) {}

  /**
   * Propriedade sumida cai no padrão em vez de lançar: um lançamento sem
   * descrição legível é degradação, uma reserva que falha por causa do texto
   * de uma descrição é quebra de produto.
   */
  async ofProperty(propertyId: string): Promise<DisplayPreferences> {
    const property = await this.propertyRepository.propertyOfId(propertyId);

    if (!property) {
      return DEFAULTS;
    }

    return this.displayPreferencesService.preferencesOf(property.user_id);
  }
}
