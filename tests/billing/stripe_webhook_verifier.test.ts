import { describe, it, expect } from "bun:test";
import Stripe from "stripe";
import { StripeWebhookVerifier } from "../../src/billing/infra/gateway/stripe_webhook_verifier";
import type { Logger } from "../../src/core/application/logger/logger";

const WEBHOOK_SECRET = "whsec_test_verifier_unit_secret";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
};

/**
 * These tests never call the Stripe network API — `constructEventAsync` is
 * pure signature verification, and `generateTestHeaderString` signs a known
 * payload locally with a known secret, so the whole flow is deterministic.
 */
async function sign(payload: string): Promise<string> {
  return Stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: WEBHOOK_SECRET,
  });
}

function checkoutCompletedPayload(overrides: {
  client_reference_id?: string | null;
  customer?: string | null;
  subscription?: string | null;
}): string {
  return JSON.stringify({
    id: "evt_checkout_1",
    object: "event",
    api_version: "2026-07-29.dahlia",
    created: 1750000000,
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        object: "checkout.session",
        client_reference_id:
          overrides.client_reference_id === undefined
            ? "b3f6c1a0-0000-4000-8000-000000000001"
            : overrides.client_reference_id,
        customer:
          overrides.customer === undefined ? "cus_test_1" : overrides.customer,
        subscription:
          overrides.subscription === undefined
            ? "sub_test_1"
            : overrides.subscription,
      },
    },
  });
}

describe("StripeWebhookVerifier — signature (R-1, DA-2)", () => {
  it("rejects a request with no signature header", async () => {
    const verifier = new StripeWebhookVerifier(WEBHOOK_SECRET, silentLogger);
    const payload = checkoutCompletedPayload({});

    await expect(
      verifier.verify({ raw_payload: payload, signature: null })
    ).rejects.toThrow();
  });

  it("rejects a forged signature", async () => {
    const verifier = new StripeWebhookVerifier(WEBHOOK_SECRET, silentLogger);
    const payload = checkoutCompletedPayload({});

    await expect(
      verifier.verify({
        raw_payload: payload,
        signature: "t=1,v1=deadbeefnotreal",
      })
    ).rejects.toThrow();
  });

  it("rejects a signature computed with the wrong secret", async () => {
    const verifier = new StripeWebhookVerifier(WEBHOOK_SECRET, silentLogger);
    const payload = checkoutCompletedPayload({});
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload,
      secret: "whsec_a_completely_different_secret",
    });

    await expect(
      verifier.verify({ raw_payload: payload, signature })
    ).rejects.toThrow();
  });

  it("rejects when the raw payload was tampered with after signing", async () => {
    const verifier = new StripeWebhookVerifier(WEBHOOK_SECRET, silentLogger);
    const payload = checkoutCompletedPayload({});
    const signature = await sign(payload);
    const tampered = payload.replace("cus_test_1", "cus_attacker_controlled");

    await expect(
      verifier.verify({ raw_payload: tampered, signature })
    ).rejects.toThrow();
  });

  it("accepts a correctly signed payload and normalizes it", async () => {
    const verifier = new StripeWebhookVerifier(WEBHOOK_SECRET, silentLogger);
    const payload = checkoutCompletedPayload({});
    const signature = await sign(payload);

    const event = await verifier.verify({ raw_payload: payload, signature });

    expect(event).toMatchObject({
      type: "checkout_completed",
      user_id: "b3f6c1a0-0000-4000-8000-000000000001",
      external_customer_reference: "cus_test_1",
      external_reference: "sub_test_1",
    });
  });
});

describe("StripeWebhookVerifier — normalization edge cases", () => {
  it("returns null (ignored) for an unhandled event type", async () => {
    const verifier = new StripeWebhookVerifier(WEBHOOK_SECRET, silentLogger);
    const payload = JSON.stringify({
      id: "evt_unhandled_1",
      object: "event",
      api_version: "2026-07-29.dahlia",
      created: 1750000000,
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      type: "customer.created",
      data: { object: { id: "cus_test_1", object: "customer" } },
    });
    const signature = await sign(payload);

    const event = await verifier.verify({ raw_payload: payload, signature });

    expect(event).toBeNull();
  });

  it("returns null for checkout.session.completed missing client_reference_id", async () => {
    const verifier = new StripeWebhookVerifier(WEBHOOK_SECRET, silentLogger);
    const payload = checkoutCompletedPayload({ client_reference_id: null });
    const signature = await sign(payload);

    const event = await verifier.verify({ raw_payload: payload, signature });

    expect(event).toBeNull();
  });
});
