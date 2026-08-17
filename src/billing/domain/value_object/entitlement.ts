export type BlockedReason =
  | "trial_expired"
  | "period_expired"
  | "payment_failed"
  | "no_subscription";

export type EntitlementData = {
  has_platform_access: boolean;
  status: string;
  max_properties: number;
  blocked_reason?: BlockedReason;
};

/**
 * Read-only value object: the access decision for a user at a given instant.
 * Always derived on the fly by `SubscriptionAccessPolicy`, never persisted.
 */
export class Entitlement {
  readonly #data: EntitlementData;

  private constructor(data: EntitlementData) {
    this.#data = data;
  }

  public static of(data: EntitlementData): Entitlement {
    return new Entitlement(data);
  }

  get has_platform_access() {
    return this.#data.has_platform_access;
  }

  get status() {
    return this.#data.status;
  }

  get max_properties() {
    return this.#data.max_properties;
  }

  get blocked_reason() {
    return this.#data.blocked_reason;
  }
}
