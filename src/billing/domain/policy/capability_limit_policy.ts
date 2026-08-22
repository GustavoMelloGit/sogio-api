import { ForbiddenError } from "../../../core/application/error/forbidden_error";
import type { CapabilityKey } from "../capability/capability_key";
import { capabilityRegistryEntryOf } from "../capability/capability_registry";

export class CapabilityLimitPolicy {
  static ensureWithinLimit(
    key: CapabilityKey,
    currentCount: number,
    limit: number
  ): void {
    if (currentCount >= limit) {
      const { label } = capabilityRegistryEntryOf(key);
      const capitalizedLabel = `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
      throw new ForbiddenError(
        `${capitalizedLabel} limit reached (${limit}). Upgrade your plan to add more ${label}.`
      );
    }
  }
}
