import type { DisplayPreferences } from "../../../auth/application/service/display_preferences_service";
import type { Locale } from "../../../core/domain/locale/locale";

export type StayLedgerReference = {
  tenant_name: string;
  check_in: Date;
  check_out: Date;
};

type StayLedgerCopy = {
  period(from: string, to: string): string;
  revenue(reference: string): string;
  cancellation(reference: string): string;
};

const COPY: Record<Locale, StayLedgerCopy> = {
  "pt-BR": {
    period: (from, to) => `${from} a ${to}`,
    revenue: reference => `Pagamento de estadia: ${reference}`,
    cancellation: reference => `Estadia cancelada: ${reference}`,
  },
  "en-US": {
    period: (from, to) => `${from} to ${to}`,
    revenue: reference => `Stay payment: ${reference}`,
    cancellation: reference => `Stay canceled: ${reference}`,
  },
};

function stayReference(
  { tenant_name, check_in, check_out }: StayLedgerReference,
  preferences: DisplayPreferences
): string {
  const formatter = new Intl.DateTimeFormat(preferences.locale, {
    timeZone: preferences.time_zone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const period = COPY[preferences.locale].period(
    formatter.format(check_in),
    formatter.format(check_out)
  );

  return `${tenant_name} (${period})`;
}

export function describeStayRevenue(
  stay: StayLedgerReference,
  preferences: DisplayPreferences
): string {
  return COPY[preferences.locale].revenue(stayReference(stay, preferences));
}

export function describeStayCancellation(
  stay: StayLedgerReference,
  preferences: DisplayPreferences
): string {
  return COPY[preferences.locale].cancellation(
    stayReference(stay, preferences)
  );
}
