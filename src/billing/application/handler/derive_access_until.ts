import type { SubscriptionStatus } from "../../domain/entity/subscription";

export function deriveAccessUntil(
  status: SubscriptionStatus,
  trial_ends_at: Date | null,
  current_period_end: Date | null
): Date | null {
  return status === "trialing" ? trial_ends_at : current_period_end;
}
