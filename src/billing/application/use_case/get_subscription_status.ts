import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../../auth/domain/entity/user";
import type { EntitlementService } from "../service/entitlement_service";
import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";
import type {
  BlockedReason,
  EntitlementPlan,
} from "../../domain/value_object/entitlement";
import type { CapabilityKey } from "../../domain/capability/capability_key";

type Input = Record<string, never>;

type Output = {
  has_platform_access: boolean;
  status: string;
  capabilities: Record<CapabilityKey, boolean | number>;
  plan: EntitlementPlan | null;
  blocked_reason?: BlockedReason;
  needs_plan_choice: boolean;
};

export class GetSubscriptionStatusUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly entitlementService: EntitlementService,
    private readonly subscriptionRepository: SubscriptionRepository
  ) {}

  async execute(_input: Input, user: User): Promise<Output> {
    const entitlement = await this.entitlementService.entitlementOf(user.id);
    const subscription = await this.subscriptionRepository.subscriptionOfUser(
      user.id
    );

    return {
      has_platform_access: entitlement.has_platform_access,
      status: entitlement.status,
      capabilities: entitlement.capabilities.toRecord(),
      plan: entitlement.plan,
      blocked_reason: entitlement.blocked_reason,
      needs_plan_choice: subscription?.needs_plan_choice ?? false,
    };
  }
}
