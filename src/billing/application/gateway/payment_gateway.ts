import type { GatewayCatalogEntry } from "./gateway_catalog_entry";

type CreateCustomerInput = {
  user_id: string;
  email: string;
};

type CreateCheckoutSessionInput = {
  external_customer_reference: string;
  external_price_reference: string;

  client_reference_id: string;
  success_url: string;
  cancel_url: string;

  trial_period_days?: number;
};

type CreateBillingPortalSessionInput = {
  external_customer_reference: string;
  return_url: string;
};

export interface PaymentGateway {
  createCustomer(input: CreateCustomerInput): Promise<string>;
  createCheckoutSession(
    input: CreateCheckoutSessionInput
  ): Promise<{ url: string }>;
  createBillingPortalSession(
    input: CreateBillingPortalSessionInput
  ): Promise<{ url: string }>;

  listCatalogEntries(): Promise<GatewayCatalogEntry[]>;
}
