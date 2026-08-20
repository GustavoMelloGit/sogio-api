import type { BillingInterval } from "../../domain/entity/plan";

/**
 * A gateway Price already normalized into the Sogio vocabulary (§2.2) — not
 * a `Plan`, the raw material one is synced from. Produced exclusively by the
 * parser in `infra/gateway/` (DA-4, DA-6), shared by the webhook verifier
 * and `PaymentGateway.listCatalogEntries` so there is exactly one place
 * deciding what counts as a valid catalog entry.
 */
export type GatewayCatalogEntry = {
  external_price_reference: string;
  external_product_reference: string | null;
  code: string;
  name: string;
  price_amount: number;
  billing_interval: BillingInterval;
  max_properties: number;
  trial_days: number;
  /** Whether the gateway currently offers this Price (`price.active`) — the explicit retirement/restoration signal I-3 requires. */
  is_offered: boolean;
};
