import { describe, it, expect, beforeEach } from "bun:test";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { CreateBillingPortalSessionUseCase } from "../../src/billing/application/use_case/create_billing_portal_session";
import { SubscriptionPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";
import type { PaymentGateway } from "../../src/billing/application/gateway/payment_gateway";

const TABLES = ["properties", "addresses", "users"];
const FRONT_BASE_URL = "http://localhost:5173";

const subscriptionRepository = new SubscriptionPostgresRepository();

class StubPaymentGateway implements PaymentGateway {
  createBillingPortalSessionCalls: Parameters<
    PaymentGateway["createBillingPortalSession"]
  >[0][] = [];

  async createCustomer(): Promise<string> {
    throw new Error("not used in this test");
  }

  async createCheckoutSession(): Promise<{ url: string }> {
    throw new Error("not used in this test");
  }

  async createBillingPortalSession(
    input: Parameters<PaymentGateway["createBillingPortalSession"]>[0]
  ): Promise<{ url: string }> {
    this.createBillingPortalSessionCalls.push(input);
    return { url: "https://billing.stripe.com/test-portal" };
  }

  async listCatalogEntries(): Promise<
    Awaited<ReturnType<PaymentGateway["listCatalogEntries"]>>
  > {
    throw new Error("not used in this test");
  }
}

describe("CreateBillingPortalSessionUseCase", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("rejects when the account has no gateway customer yet", async () => {
    const { user } = await createUserFixture({
      name: "Conta Portal Sem Cliente",
      email: "portal.no-customer@sogio.dev",
      password: "password123",
    });
    const gateway = new StubPaymentGateway();
    const useCase = new CreateBillingPortalSessionUseCase(
      subscriptionRepository,
      gateway,
      FRONT_BASE_URL
    );

    await expect(useCase.execute({}, user)).rejects.toMatchObject({
      name: "ConflictError",
    });
  });

  it("resolves the customer reference from the caller's own subscription, never the request", async () => {
    const { user } = await createUserFixture({
      name: "Conta Portal",
      email: "portal.own-subscription@sogio.dev",
      password: "password123",
    });

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("test setup: no subscription");
    subscription.linkCustomer("cus_portal_owner");
    await subscriptionRepository.save(subscription);

    const gateway = new StubPaymentGateway();
    const useCase = new CreateBillingPortalSessionUseCase(
      subscriptionRepository,
      gateway,
      FRONT_BASE_URL
    );

    const result = await useCase.execute({}, user);

    expect(result.url).toBe("https://billing.stripe.com/test-portal");
    expect(
      gateway.createBillingPortalSessionCalls[0]?.external_customer_reference
    ).toBe("cus_portal_owner");
    expect(gateway.createBillingPortalSessionCalls[0]?.return_url).toBe(
      `${FRONT_BASE_URL}/settings/billing?portal=return`
    );
  });
});
