import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../../auth/domain/entity/user";
import type { EntitlementService } from "../service/entitlement_service";
import type {
  BlockedReason,
  EntitlementPlan,
} from "../../domain/value_object/entitlement";

type Input = Record<string, never>;

type Output = {
  has_platform_access: boolean;
  status: string;
  max_properties: number;
  plan: EntitlementPlan | null;
  blocked_reason?: BlockedReason;
};

export class GetSubscriptionStatusUseCase implements UseCase<Input, Output> {
  constructor(private readonly entitlementService: EntitlementService) {}

  async execute(_input: Input, user: User): Promise<Output> {
    const entitlement = await this.entitlementService.entitlementOf(user.id);

    return {
      has_platform_access: entitlement.has_platform_access,
      status: entitlement.status,
      max_properties: entitlement.max_properties,
      plan: entitlement.plan,
      blocked_reason: entitlement.blocked_reason,
    };
  }
}
