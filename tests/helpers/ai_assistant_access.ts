import type { AiAssistantAccess } from "../../src/auth/application/service/ai_assistant_access";
import { SubscriptionAiAssistantAccess } from "../../src/billing/application/service/subscription_ai_assistant_access";
import { makeTestEntitlementService } from "./entitlement_service";

export function makeTestAiAssistantAccess(): AiAssistantAccess {
  return new SubscriptionAiAssistantAccess(makeTestEntitlementService());
}
