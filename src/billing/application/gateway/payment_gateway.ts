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
}
