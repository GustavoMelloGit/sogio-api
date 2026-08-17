import type { GatewayBillingEvent } from "./gateway_billing_event";

type VerifyInput = {
  /** The exact bytes the gateway signed — never a reserialized object (DA-2 item 2). */
  raw_payload: string;
  signature: string | null;
};

/**
 * Inbound port (DA-1). `verify` is the only entrypoint the webhook use case
 * calls, and it runs as the very first instruction (DA-2) — there is no path
 * that reaches a domain transition with an unverified event.
 *
 * Throws `UnauthorizedError` when the signature is missing or invalid.
 * Returns `null` for a verified event of a type this system doesn't act on
 * (DA-3's "200 and ignored") — that is not an authentication failure.
 */
export interface GatewayWebhookVerifier {
  verify(input: VerifyInput): Promise<GatewayBillingEvent | null>;
}
