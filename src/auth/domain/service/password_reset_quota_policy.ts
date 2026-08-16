/**
 * Cota Mensal de Recuperação (§2.4/§2.5 do plano) — regra de negócio
 * independente do rate limit de infraestrutura, no molde de
 * `isConsentExpired`: os números moram aqui, o use case só aplica.
 * Janela móvel de 30 dias (DP1), não mês-calendário.
 */
const PASSWORD_RESET_MONTHLY_LIMIT = 3;
const PASSWORD_RESET_QUOTA_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function passwordResetQuotaWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - PASSWORD_RESET_QUOTA_WINDOW_MS);
}

export function isPasswordResetQuotaExceeded(
  requestsInWindow: number
): boolean {
  return requestsInWindow >= PASSWORD_RESET_MONTHLY_LIMIT;
}
