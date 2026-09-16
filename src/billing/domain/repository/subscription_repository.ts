import type { Subscription } from "../entity/subscription";
import type { Plan } from "../entity/plan";

export type SubscriptionWithPlan = {
  subscription: Subscription;
  plan: Plan;
};

export interface SubscriptionRepository {
  subscriptionOfUser(user_id: string): Promise<Subscription | null>;

  currentSubscriptionWithPlanOfUser(
    user_id: string
  ): Promise<SubscriptionWithPlan | null>;

  subscriptionOfExternalCustomerReference(
    reference: string
  ): Promise<Subscription | null>;

  subscriptionOfExternalReference(
    reference: string
  ): Promise<Subscription | null>;

  linkCustomerReferenceIfAbsent(
    subscription_id: string,
    reference: string
  ): Promise<string>;
  save(subscription: Subscription): Promise<void>;
}
