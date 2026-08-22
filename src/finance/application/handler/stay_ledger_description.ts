export const STAY_LEDGER_TIME_ZONE = "America/Sao_Paulo";

const stayDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: STAY_LEDGER_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export type StayLedgerReference = {
  tenant_name: string;
  check_in: Date;
  check_out: Date;
};

function stayReference({
  tenant_name,
  check_in,
  check_out,
}: StayLedgerReference): string {
  const period = `${stayDateFormatter.format(check_in)} a ${stayDateFormatter.format(check_out)}`;

  return `${tenant_name} (${period})`;
}

export function describeStayRevenue(stay: StayLedgerReference): string {
  return `Pagamento de estadia: ${stayReference(stay)}`;
}

export function describeStayCancellation(stay: StayLedgerReference): string {
  return `Estadia cancelada: ${stayReference(stay)}`;
}
