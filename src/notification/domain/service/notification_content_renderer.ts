import type { Locale } from "../../../core/domain/locale/locale";
import {
  notificationTypeEntryOf,
  type NotificationContent,
  type NotificationFormatters,
} from "../notification_type/notification_type_registry";

/**
 * Produz o texto de uma notificação no idioma e no fuso do destinatário, a
 * partir dos fatos persistidos com ela. Devolve `null` — nunca lança — quando
 * o tipo saiu do registro ou o payload não satisfaz o contrato do tipo: uma
 * notificação irrenderizável falha sozinha, sem derrubar o lote de entrega.
 */
export class NotificationContentRenderer {
  readonly #formatters = new Map<string, NotificationFormatters>();

  render(
    type: string,
    data: unknown,
    locale: Locale,
    timeZone: string
  ): NotificationContent | null {
    const entry = notificationTypeEntryOf(type);

    if (!entry) {
      return null;
    }

    return entry.render(data, locale, this.#formattersFor(locale, timeZone));
  }

  #formattersFor(locale: Locale, timeZone: string): NotificationFormatters {
    const cacheKey = `${locale}|${timeZone}`;
    const cached = this.#formatters.get(cacheKey);

    if (cached) {
      return cached;
    }

    const dateFormatter = new Intl.DateTimeFormat(locale, {
      timeZone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    const formatters: NotificationFormatters = {
      date: value => dateFormatter.format(value),
    };

    this.#formatters.set(cacheKey, formatters);

    return formatters;
  }
}
