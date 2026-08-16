import type { BillingInterval } from "../entity/plan";

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
}
