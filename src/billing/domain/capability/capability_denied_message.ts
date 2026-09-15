import type { CapabilityKey } from "./capability_key";
import type { AccessCapabilityKey } from "./capability_registry";
import { capabilityRegistryEntryOf } from "./capability_registry";

export const AI_ASSISTANT_CAPABILITY_KEY: AccessCapabilityKey = "ai_assistant";

export function capabilityDeniedMessage(key: CapabilityKey): string {
  const { label } = capabilityRegistryEntryOf(key);
  return `Your current plan doesn't include ${label}. Upgrade your plan to unlock it.`;
}
