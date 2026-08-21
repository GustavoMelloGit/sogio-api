import type { GatewayBillingEvent } from "./gateway_billing_event";
import type { GatewayCatalogEvent } from "./gateway_catalog_event";

type VerifyInput = {
  raw_payload: string;
  signature: string | null;
};

export interface GatewayWebhookVerifier {
  verify(
    input: VerifyInput
  ): Promise<GatewayBillingEvent | GatewayCatalogEvent | null>;
}
