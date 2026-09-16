import { describe, it, expect, beforeEach } from "bun:test";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { CreateCheckoutSessionUseCase } from "../../src/billing/application/use_case/create_checkout_session";
import { SubscriptionPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";
import { PlanPostgresRepository } from "../../src/billing/infra/database/postgres_repository/plan_postgres_repository";
import type { PaymentGateway } from "../../src/billing/application/gateway/payment_gateway";
import { db } from "../../src/core/infra/database/drizzle/database";
import { plansTable } from "../../src/core/infra/database/drizzle/schema";
import { eq } from "drizzle-orm";
import { api } from "../helpers/server";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { CreateCheckoutSessionController } from "../../src/billing/presentation/controller/create_checkout_session.controller";

const TABLES = ["properties", "addresses", "users"];
const FRONT_BASE_URL = "http://localhost:5173";

const subscriptionRepository = new SubscriptionPostgresRepository();
const planRepository = new PlanPostgresRepository();

class StubPaymentGateway implements PaymentGateway {
  createCustomerCalls: { user_id: string; email: string }[] = [];
  createCheckoutSessionCalls: Parameters<
    PaymentGateway["createCheckoutSession"]
  >[0][] = [];

  async createCustomer(input: {
    user_id: string;
    email: string;
  }): Promise<string> {
    this.createCustomerCalls.push(input);
    return `cus_stub_${input.user_id}`;
  }

  async createCheckoutSession(
    input: Parameters<PaymentGateway["createCheckoutSession"]>[0]
  ): Promise<{ url: string }> {
    this.createCheckoutSessionCalls.push(input);
    return { url: "https://checkout.stripe.com/test-session" };
  }

  async createBillingPortalSession(): Promise<{ url: string }> {
    throw new Error("not used in this test");
  }

  async listCatalogEntries(): Promise<
    Awaited<ReturnType<PaymentGateway["listCatalogEntries"]>>
  > {
    throw new Error("not used in this test");
  }
}

async function setProPriceReference(): Promise<void> {
  const pro = await planRepository.planOfCode("pro");
  if (!pro) throw new Error("test setup: pro plan not seeded");
  await db
    .update(plansTable)
    .set({ external_price_reference: "price_pro_test" })
    .where(eq(plansTable.id, pro.id));
}

async function clearProPriceReference(): Promise<void> {
  const pro = await planRepository.planOfCode("pro");
  if (!pro) throw new Error("test setup: pro plan not seeded");
  await db
    .update(plansTable)
    .set({ external_price_reference: null })
    .where(eq(plansTable.id, pro.id));
}

describe("CreateCheckoutSessionUseCase (DA-4)", () => {
  // `plans` isn't in TABLES (it's shared, not per-test) — another test file
  // may have left external_price_reference set on the pro plan, so this
  // resets it explicitly instead of assuming a clean slate.
  beforeEach(async () => {
    await truncate(TABLES);
    await clearProPriceReference();
  });

  it("returns 404 for a nonexistent plan", async () => {
    const { user } = await createUserFixture({
      name: "Conta Checkout 404",
      email: "checkout.404@sogio.dev",
      password: "password123",
    });
    const gateway = new StubPaymentGateway();
    const useCase = new CreateCheckoutSessionUseCase(
      subscriptionRepository,
      planRepository,
      gateway,
      FRONT_BASE_URL
    );

    await expect(
      useCase.execute(
        { plan_code: "does-not-exist", return_to: "billing" },
        user
      )
    ).rejects.toThrow();
  });

  it("rejects checkout for the perpetual Free plan", async () => {
    const { user } = await createUserFixture({
      name: "Conta Checkout Free",
      email: "checkout.free@sogio.dev",
      password: "password123",
    });
    const gateway = new StubPaymentGateway();
    const useCase = new CreateCheckoutSessionUseCase(
      subscriptionRepository,
      planRepository,
      gateway,
      FRONT_BASE_URL
    );

    await expect(
      useCase.execute({ plan_code: "free", return_to: "billing" }, user)
    ).rejects.toThrow();
  });

  it("fails with a typed error (not silent) when the plan has no external_price_reference (item j)", async () => {
    const { user } = await createUserFixture({
      name: "Conta Checkout Sem Preco",
      email: "checkout.no-price@sogio.dev",
      password: "password123",
    });
    const gateway = new StubPaymentGateway();
    const useCase = new CreateCheckoutSessionUseCase(
      subscriptionRepository,
      planRepository,
      gateway,
      FRONT_BASE_URL
    );

    await expect(
      useCase.execute({ plan_code: "pro", return_to: "billing" }, user)
    ).rejects.toMatchObject({ name: "IllegalStateError" });
  });

  it("creates and links a gateway customer on first checkout, then reuses it", async () => {
    await setProPriceReference();
    const { user } = await createUserFixture({
      name: "Conta Checkout Novo Cliente",
      email: "checkout.new-customer@sogio.dev",
      password: "password123",
    });
    const gateway = new StubPaymentGateway();
    const useCase = new CreateCheckoutSessionUseCase(
      subscriptionRepository,
      planRepository,
      gateway,
      FRONT_BASE_URL
    );

    const result = await useCase.execute(
      { plan_code: "pro", return_to: "billing" },
      user
    );

    expect(result.url).toBe("https://checkout.stripe.com/test-session");
    expect(gateway.createCustomerCalls).toHaveLength(1);
    expect(
      gateway.createCheckoutSessionCalls[0]?.external_customer_reference
    ).toBe(`cus_stub_${user.id}`);

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    expect(subscription?.external_customer_reference).toBe(
      `cus_stub_${user.id}`
    );
  });

  it("requests trial_period_days when the subscription never used a trial (item h, R-5)", async () => {
    await setProPriceReference();
    const { user } = await createUserFixture({
      name: "Conta Checkout Trial",
      email: "checkout.trial@sogio.dev",
      password: "password123",
    });
    const gateway = new StubPaymentGateway();
    const useCase = new CreateCheckoutSessionUseCase(
      subscriptionRepository,
      planRepository,
      gateway,
      FRONT_BASE_URL
    );

    await useCase.execute({ plan_code: "pro", return_to: "billing" }, user);

    expect(gateway.createCheckoutSessionCalls[0]?.trial_period_days).toBe(14);
  });

  it("does not request trial_period_days once the subscription has already used a trial (item h, R-5)", async () => {
    await setProPriceReference();
    const { user } = await createUserFixture({
      name: "Conta Checkout Sem Trial",
      email: "checkout.no-trial@sogio.dev",
      password: "password123",
    });

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("test setup: no subscription");
    subscription.startTrialUntil(new Date(Date.now() + 1000));
    subscription.cancel({ is_perpetual: false });
    await subscriptionRepository.save(subscription);

    const gateway = new StubPaymentGateway();
    const useCase = new CreateCheckoutSessionUseCase(
      subscriptionRepository,
      planRepository,
      gateway,
      FRONT_BASE_URL
    );

    await useCase.execute({ plan_code: "pro", return_to: "billing" }, user);

    expect(
      gateway.createCheckoutSessionCalls[0]?.trial_period_days
    ).toBeUndefined();
  });

  it("rejects a second checkout while a gateway subscription is already live (item g, R-4)", async () => {
    await setProPriceReference();
    const { user } = await createUserFixture({
      name: "Conta Checkout Duplo",
      email: "checkout.duplicate@sogio.dev",
      password: "password123",
    });

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("test setup: no subscription");
    subscription.linkCustomer("cus_already_live");
    subscription.activate({
      is_perpetual: false,
      period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      external_reference: "sub_already_live",
    });
    await subscriptionRepository.save(subscription);

    const gateway = new StubPaymentGateway();
    const useCase = new CreateCheckoutSessionUseCase(
      subscriptionRepository,
      planRepository,
      gateway,
      FRONT_BASE_URL
    );

    await expect(
      useCase.execute({ plan_code: "pro", return_to: "billing" }, user)
    ).rejects.toMatchObject({ name: "ConflictError" });
    expect(gateway.createCheckoutSessionCalls).toHaveLength(0);
  });

  it("allows a new checkout once the previous gateway subscription is canceled", async () => {
    await setProPriceReference();
    const { user } = await createUserFixture({
      name: "Conta Checkout Reabertura",
      email: "checkout.reopen@sogio.dev",
      password: "password123",
    });

    const subscription = await subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) throw new Error("test setup: no subscription");
    subscription.linkCustomer("cus_reopen");
    subscription.activate({
      is_perpetual: false,
      period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      external_reference: "sub_reopen",
    });
    subscription.cancel({ is_perpetual: false });
    await subscriptionRepository.save(subscription);

    const gateway = new StubPaymentGateway();
    const useCase = new CreateCheckoutSessionUseCase(
      subscriptionRepository,
      planRepository,
      gateway,
      FRONT_BASE_URL
    );

    const result = await useCase.execute(
      { plan_code: "pro", return_to: "billing" },
      user
    );
    expect(result.url).toBe("https://checkout.stripe.com/test-session");
  });
});

describe("CreateCheckoutSessionUseCase — return URLs", () => {
  beforeEach(async () => {
    await truncate(TABLES);
    await clearProPriceReference();
    await setProPriceReference();
  });

  it("returns to the billing settings page under /app for return_to billing", async () => {
    const { user } = await createUserFixture({
      name: "Conta Checkout Retorno Billing",
      email: "checkout.return.billing@sogio.dev",
      password: "password123",
    });
    const gateway = new StubPaymentGateway();
    const useCase = new CreateCheckoutSessionUseCase(
      subscriptionRepository,
      planRepository,
      gateway,
      FRONT_BASE_URL
    );

    await useCase.execute({ plan_code: "pro", return_to: "billing" }, user);

    expect(gateway.createCheckoutSessionCalls[0]?.success_url).toBe(
      `${FRONT_BASE_URL}/app/settings/billing?checkout=success`
    );
    expect(gateway.createCheckoutSessionCalls[0]?.cancel_url).toBe(
      `${FRONT_BASE_URL}/app/settings/billing?checkout=canceled`
    );
  });

  it("returns to the app home for return_to onboarding", async () => {
    const { user } = await createUserFixture({
      name: "Conta Checkout Retorno Onboarding",
      email: "checkout.return.onboarding@sogio.dev",
      password: "password123",
    });
    const gateway = new StubPaymentGateway();
    const useCase = new CreateCheckoutSessionUseCase(
      subscriptionRepository,
      planRepository,
      gateway,
      FRONT_BASE_URL
    );

    await useCase.execute({ plan_code: "pro", return_to: "onboarding" }, user);

    expect(gateway.createCheckoutSessionCalls[0]?.success_url).toBe(
      `${FRONT_BASE_URL}/app?checkout=success`
    );
    expect(gateway.createCheckoutSessionCalls[0]?.cancel_url).toBe(
      `${FRONT_BASE_URL}/app?checkout=canceled`
    );
  });
});

describe("POST /billing/checkout-session — return_to", () => {
  beforeEach(async () => {
    await truncate(TABLES);
    await clearProPriceReference();
  });

  it("defaults return_to to billing when the caller omits it", () => {
    const controller = new CreateCheckoutSessionController(
      {} as CreateCheckoutSessionUseCase
    );

    const parsed = controller.inputSchema.parse({ plan_code: "pro" });

    expect(parsed.return_to).toBe("billing");
  });

  it("forwards the validated return_to to the use case", async () => {
    type CheckoutInput = Parameters<CreateCheckoutSessionUseCase["execute"]>[0];
    const calls: CheckoutInput[] = [];
    const controller = new CreateCheckoutSessionController({
      execute: async (input: CheckoutInput) => {
        calls.push(input);
        return { url: "https://checkout.stripe.com/test-session" };
      },
    } as unknown as CreateCheckoutSessionUseCase);
    const { user } = await createUserFixture({
      name: "Conta Checkout Controller",
      email: "checkout.return.controller@sogio.dev",
      password: "password123",
    });

    await controller.handle(
      {
        body: controller.inputSchema.parse({
          plan_code: "pro",
          return_to: "onboarding",
        }),
      } as unknown as Parameters<CreateCheckoutSessionController["handle"]>[0],
      user
    );

    expect(calls).toEqual([{ plan_code: "pro", return_to: "onboarding" }]);
  });

  for (const returnTo of [
    "https://evil.example/phish",
    "/app/settings/billing",
    "//evil.example",
    "BILLING",
    "",
  ]) {
    it(`rejects return_to ${JSON.stringify(returnTo)} with 422`, async () => {
      const { user } = await createUserFixture({
        name: "Conta Checkout Retorno Invalido",
        email: "checkout.return.invalid@sogio.dev",
        password: "password123",
      });
      const token = await createAuthToken(user.id);

      const res = await api("/billing/checkout-session", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: JSON.stringify({ plan_code: "pro", return_to: returnTo }),
      });

      expect(res.status).toBe(422);
    });
  }
});
