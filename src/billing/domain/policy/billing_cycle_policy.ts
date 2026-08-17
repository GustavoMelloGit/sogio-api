import type { BillingInterval } from "../entity/plan";

/** Tolerance window a past_due subscription gets before access is cut off (Q-2). */
const GRACE_PERIOD_DAYS = 7;

/** Single place that computes when a billing period ends, given its start. */
export class BillingCyclePolicy {
  static nextPeriodEnd(start: Date, interval: BillingInterval): Date {
    switch (interval) {
      case "monthly": {
        const end = new Date(start);
        end.setMonth(end.getMonth() + 1);
        return end;
      }
    }
  }

  static gracePeriodEnd(now: Date): Date {
    const end = new Date(now);
    end.setDate(end.getDate() + GRACE_PERIOD_DAYS);
    return end;
  }
}
