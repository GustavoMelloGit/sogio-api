import type { SubscriptionStatus } from "../entity/subscription";

/**
 * Até quando o acesso já concedido vale. Regra de domínio, não de
 * apresentação: uma assinatura em trial vale até o fim do trial, qualquer
 * outra até o fim do ciclo pago.
 */
export class AccessUntilPolicy {
  static resolve(
    status: SubscriptionStatus,
    trial_ends_at: Date | null,
    current_period_end: Date | null
  ): Date | null {
    return status === "trialing" ? trial_ends_at : current_period_end;
  }
}
