export type BlockedReason =
  | "trial_expired"
  | "period_expired"
  | "payment_failed"
  | "no_subscription";

export type EntitlementPlan = {
  id: string;
  code: string;
  name: string;
};

export type EntitlementData = {
  has_platform_access: boolean;
  status: string;
  max_properties: number;
  plan: EntitlementPlan | null;
  blocked_reason?: BlockedReason;
};

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

  get plan() {
    return this.#data.plan;
  }

  get blocked_reason() {
    return this.#data.blocked_reason;
  }
}
