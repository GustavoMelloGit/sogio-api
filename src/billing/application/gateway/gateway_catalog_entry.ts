import type { CapabilityKey } from "../../domain/capability/capability_key";
import type { BillingInterval } from "../../domain/entity/plan";

export type GatewayCatalogEntry = {
  external_price_reference: string;
  external_product_reference: string | null;
  code: string;
  name: string;
  price_amount: number;
  billing_interval: BillingInterval;
  capabilities: Record<CapabilityKey, boolean | number>;
  trial_days: number;

  is_offered: boolean;
};
