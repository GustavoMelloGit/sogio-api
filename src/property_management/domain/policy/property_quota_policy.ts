import { ForbiddenError } from "../../../core/application/error/forbidden_error";

/** Independent of platform-access blocking (DA-10): the quota bites even on a subscription in good standing. */
export class PropertyQuotaPolicy {
  static ensureWithinLimit(currentCount: number, maxProperties: number): void {
    if (currentCount >= maxProperties) {
      throw new ForbiddenError(
        `Property limit reached (${maxProperties}). Upgrade your plan to add more properties.`
      );
    }
  }
}
