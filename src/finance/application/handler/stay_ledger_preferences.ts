import type {
  DisplayPreferences,
  DisplayPreferencesService,
} from "../../../auth/application/service/display_preferences_service";
import {
  DEFAULT_LOCALE,
  DEFAULT_TIME_ZONE,
} from "../../../core/domain/locale/locale";
import type { PropertyRepository } from "../../../property_management/domain/repository/property_repository";

/**
 * A descrição de um lançamento é escrita para o dono do imóvel, mas os
 * eventos de estadia carregam a propriedade, não o dono. `propertyOfId`
 * deliberadamente não filtra `deleted_at`, o que é o que faz este caminho
 * funcionar durante a exclusão em cascata de uma propriedade — é exatamente
 * quando `RevertRevenueOnStayCancel` roda.
 *
 * Propriedade sumida cai no padrão em vez de lançar: um lançamento sem
 * descrição legível é degradação, uma reserva que falha por causa do texto
 * de uma descrição é quebra de produto.
 */
export async function stayLedgerPreferences(
  propertyId: string,
  propertyRepository: PropertyRepository,
  displayPreferencesService: DisplayPreferencesService
): Promise<DisplayPreferences> {
  const property = await propertyRepository.propertyOfId(propertyId);

  if (!property) {
    return { locale: DEFAULT_LOCALE, time_zone: DEFAULT_TIME_ZONE };
  }

  return displayPreferencesService.preferencesOf(property.user_id);
}
