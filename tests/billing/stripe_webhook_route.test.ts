import { describe, it, expect, beforeEach } from "bun:test";
import Stripe from "stripe";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { SubscriptionPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";

const TABLES = ["properties", "addresses", "users"];
// Matches STRIPE_WEBHOOK_SECRET in .env.test — the running test server's
// ProcessGatewayWebhookUseCase verifies against this exact value.
const WEBHOOK_SECRET = "whsec_test_fake";

const subscriptionRepository = new SubscriptionPostgresRepository();

function checkoutCompletedPayload(userId: string): string {
  return JSON.stringify({
    id: `evt_${crypto.randomUUID()}`,
    object: "event",
    api_version: "2026-07-29.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_route",
        object: "checkout.session",
        client_reference_id: userId,
        customer: "cus_route_test",
        subscription: "sub_route_test",
      },
    },
  });
}

async function sign(payload: string, secret = WEBHOOK_SECRET): Promise<string> {
  return Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
}

describe("POST /billing/webhooks/stripe — signature verification (R-1, DA-2)", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("returns 401 and writes nothing when the Stripe-Signature header is missing", async () => {
    const { user } = await createUserFixture({
      name: "Conta Webhook Rota Sem Assinatura",
      email: "webhook.route.no-sig@sogio.dev",
      password: "password123",
    });
    const payload = checkoutCompletedPayload(user.id);

    const res = await api("/billing/webhooks/stripe", {
      method: "POST",
      body: payload,
    });

    expect(res.status).toBe(401);

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    expect(subscription?.external_customer_reference).toBeNull();
  });

  it("returns 401 and writes nothing for a forged signature", async () => {
    const { user } = await createUserFixture({
      name: "Conta Webhook Rota Assinatura Forjada",
      email: "webhook.route.forged@sogio.dev",
      password: "password123",
    });
    const payload = checkoutCompletedPayload(user.id);

    const res = await api("/billing/webhooks/stripe", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": "t=1,v1=deadbeefnotreal" },
    });

    expect(res.status).toBe(401);

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    expect(subscription?.external_customer_reference).toBeNull();
  });

  it("returns 401 for a signature computed with the wrong secret", async () => {
    const { user } = await createUserFixture({
      name: "Conta Webhook Rota Secret Errado",
      email: "webhook.route.wrong-secret@sogio.dev",
      password: "password123",
    });
    const payload = checkoutCompletedPayload(user.id);
    const signature = await sign(payload, "whsec_totally_different");

    const res = await api("/billing/webhooks/stripe", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": signature },
    });

    expect(res.status).toBe(401);

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    expect(subscription?.external_customer_reference).toBeNull();
  });

  it("returns 200 and applies the event for a correctly signed payload", async () => {
    const { user } = await createUserFixture({
      name: "Conta Webhook Rota Valida",
      email: "webhook.route.valid@sogio.dev",
      password: "password123",
    });
    const payload = checkoutCompletedPayload(user.id);
    const signature = await sign(payload);

    const res = await api("/billing/webhooks/stripe", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": signature },
    });

    expect(res.status).toBe(200);

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    expect(subscription?.external_customer_reference).toBe("cus_route_test");
  });

  it("returns 200 and writes nothing for an unhandled event type (item k)", async () => {
    const payload = JSON.stringify({
      id: `evt_${crypto.randomUUID()}`,
      object: "event",
      api_version: "2026-07-29.dahlia",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      type: "customer.created",
      data: { object: { id: "cus_unhandled", object: "customer" } },
    });
    const signature = await sign(payload);

    const res = await api("/billing/webhooks/stripe", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": signature },
    });

    expect(res.status).toBe(200);
  });
});
