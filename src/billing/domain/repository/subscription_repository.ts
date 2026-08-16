import type { Subscription } from "../entity/subscription";
import type { Plan } from "../entity/plan";

export type SubscriptionWithPlan = {
  subscription: Subscription;
  plan: Plan;
};

export interface SubscriptionRepository {
  subscriptionOfUser(user_id: string): Promise<Subscription | null>;
  /** Single join — the entitlement gate runs on every authenticated request. */
  currentSubscriptionWithPlanOfUser(
    user_id: string
  ): Promise<SubscriptionWithPlan | null>;
  save(subscription: Subscription): Promise<void>;
}
