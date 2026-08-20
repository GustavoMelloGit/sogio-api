import type { GatewayCatalogEntry } from "./gateway_catalog_entry";

type CreateCustomerInput = {
  user_id: string;
  email: string;
};

type CreateCheckoutSessionInput = {
  external_customer_reference: string;
  external_price_reference: string;
  /** Our own `user_id` — the identity rendezvous point for `checkout_completed` (DA-2 item 5). */
  client_reference_id: string;
  success_url: string;
  cancel_url: string;
  /** Only ever set when the subscription has never used a trial (§2.5, R-5). */
  trial_period_days?: number;
};

type CreateBillingPortalSessionInput = {
  external_customer_reference: string;
  return_url: string;
};

/**
 * Outbound port (DA-1). Speaks only in opaque references and URLs — never a
 * vendor SDK type. The only implementation lives in `billing/infra/gateway/`.
 */
export interface PaymentGateway {
  /** Returns the gateway's own customer reference. */
  createCustomer(input: CreateCustomerInput): Promise<string>;
  createCheckoutSession(
    input: CreateCheckoutSessionInput
  ): Promise<{ url: string }>;
  createBillingPortalSession(
    input: CreateBillingPortalSessionInput
  ): Promise<{ url: string }>;
  /**
   * Reads the gateway's entire price catalog — active and inactive alike
   * (DA-6): inactive is the explicit retirement signal I-3 requires.
   * Entries that don't parse as a Sogio catalog entry are silently dropped
   * by the same shared parser the webhook verifier uses, never surfaced
   * here as an error (DA-4). Powers `ReconcilePlanCatalogFromGatewayUseCase`.
   */
  listCatalogEntries(): Promise<GatewayCatalogEntry[]>;
}
