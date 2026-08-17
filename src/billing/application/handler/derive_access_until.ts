import type { SubscriptionStatus } from "../../domain/entity/subscription";

/** Folds status + trial/period dates into the single "access guaranteed until" fact (§2.3). */
export function deriveAccessUntil(
  status: SubscriptionStatus,
  trial_ends_at: Date | null,
  current_period_end: Date | null
): Date | null {
  return status === "trialing" ? trial_ends_at : current_period_end;
}
