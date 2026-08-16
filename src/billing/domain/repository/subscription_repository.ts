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
  /** Resolves a subscription by its gateway customer reference — used by the webhook to identify the local subscription. */
  subscriptionOfExternalCustomerReference(
    reference: string
  ): Promise<Subscription | null>;
  /** Resolves a subscription by its gateway subscription reference — used by the webhook to identify the local subscription. */
  subscriptionOfExternalReference(
    reference: string
  ): Promise<Subscription | null>;
  /**
   * Atomic `UPDATE ... WHERE external_customer_reference IS NULL` (DA-6):
   * closes the TOCTOU window a load-mutate-save cycle would leave open
   * between two concurrent checkout clicks. Returns the reference that
   * ended up persisted — the caller's own, or whichever write won the race —
   * never assume the caller's write was the one that landed.
   */
  linkCustomerReferenceIfAbsent(
    subscription_id: string,
    reference: string
  ): Promise<string>;
  save(subscription: Subscription): Promise<void>;
}
