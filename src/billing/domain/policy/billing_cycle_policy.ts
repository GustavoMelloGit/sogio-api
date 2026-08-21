import type { BillingInterval } from "../entity/plan";

const GRACE_PERIOD_DAYS = 7;

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
