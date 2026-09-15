import type { AiAssistantAccess } from "../../../auth/application/service/ai_assistant_access";
import { AI_ASSISTANT_CAPABILITY_KEY } from "../../domain/capability/capability_denied_message";
import type { EntitlementService } from "./entitlement_service";

export class SubscriptionAiAssistantAccess implements AiAssistantAccess {
  constructor(private readonly entitlementService: EntitlementService) {}

  async canConnect(userId: string): Promise<boolean> {
    const entitlement = await this.entitlementService.entitlementOf(userId);
    return (
      entitlement.has_platform_access &&
      entitlement.capabilities.allows(AI_ASSISTANT_CAPABILITY_KEY)
    );
  }
}
