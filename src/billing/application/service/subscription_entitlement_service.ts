import type { EntitlementService } from "./entitlement_service";
import type { PlanRepository } from "../../domain/repository/plan_repository";
import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";
import { SubscriptionAccessPolicy } from "../../domain/policy/subscription_access_policy";
import { Entitlement } from "../../domain/value_object/entitlement";
import { CapabilitySet } from "../../domain/capability/capability_set";

const FREE_PLAN_CODE = "free";

export class SubscriptionEntitlementService implements EntitlementService {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly planRepository: PlanRepository
  ) {}

  async entitlementOf(user_id: string): Promise<Entitlement> {
    const current =
      await this.subscriptionRepository.currentSubscriptionWithPlanOfUser(
        user_id
      );

    if (!current) {
      return this.#noSubscription();
    }

    const freePlan = await this.planRepository.planOfCode(FREE_PLAN_CODE);
    if (!freePlan) {
      return this.#noSubscription();
    }

    return SubscriptionAccessPolicy.resolve(
      current.subscription,
      current.plan,
      freePlan
    );
  }

  #noSubscription(): Entitlement {
    return Entitlement.of({
      has_platform_access: false,
      status: "none",
      capabilities: CapabilitySet.empty(),
      plan: null,
      blocked_reason: "no_subscription",
    });
  }
}
