import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { ProcessGatewayWebhookUseCase } from "../../src/billing/application/use_case/process_gateway_webhook";
import { BindGatewayCustomerUseCase } from "../../src/billing/application/use_case/bind_gateway_customer";
import { SyncSubscriptionFromGatewayUseCase } from "../../src/billing/application/use_case/sync_subscription_from_gateway";
import { CancelSubscriptionUseCase } from "../../src/billing/application/use_case/cancel_subscription";
import { MarkSubscriptionPastDueUseCase } from "../../src/billing/application/use_case/mark_subscription_past_due";
import { SyncPlanCatalogEntryUseCase } from "../../src/billing/application/use_case/sync_plan_catalog_entry";
import { AnnounceTrialEndingUseCase } from "../../src/billing/application/use_case/announce_trial_ending";
import { GrantPlanUseCase } from "../../src/billing/application/use_case/grant_plan";
import { CreateCheckoutSessionUseCase } from "../../src/billing/application/use_case/create_checkout_session";
import { SubscriptionPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";
import { PlanPostgresRepository } from "../../src/billing/infra/database/postgres_repository/plan_postgres_repository";
import { ProcessedGatewayEventPostgresRepository } from "../../src/billing/infra/database/postgres_repository/processed_gateway_event_postgres_repository";
import { inMemoryEventDispatcher } from "../../src/core/infra/event/in_memory_event_dispatcher";
import { db } from "../../src/core/infra/database/drizzle/database";
import { plansTable } from "../../src/core/infra/database/drizzle/schema";
import type { Logger } from "../../src/core/application/logger/logger";
import type { GatewayWebhookVerifier } from "../../src/billing/application/gateway/gateway_webhook_verifier";
import type {
  GatewayBillingEvent,
  SubscriptionStateChangedEvent,
} from "../../src/billing/application/gateway/gateway_billing_event";
import type { PaymentGateway } from "../../src/billing/application/gateway/payment_gateway";
import type { User } from "../../src/auth/domain/entity/user";

const TABLES = ["properties", "addresses", "users"];
const PRO_PRICE_REFERENCE = "price_pro_test";

const subscriptionRepository = new SubscriptionPostgresRepository();
const planRepository = new PlanPostgresRepository();
const processedGatewayEventRepository =
  new ProcessedGatewayEventPostgresRepository();

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
};

class StubVerifier implements GatewayWebhookVerifier {
  constructor(private readonly event: GatewayBillingEvent) {}

  async verify(): Promise<GatewayBillingEvent | null> {
    return this.event;
  }
}

class StubPaymentGateway implements PaymentGateway {
  async createCustomer(input: { user_id: string }): Promise<string> {
    return `cus_stub_${input.user_id}`;
  }

  async createCheckoutSession(): Promise<{ url: string }> {
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

function makeWebhookUseCase(
  event: GatewayBillingEvent
): ProcessGatewayWebhookUseCase {
  const cancelSubscriptionUseCase = new CancelSubscriptionUseCase(
    subscriptionRepository,
    planRepository,
    inMemoryEventDispatcher
  );

  return new ProcessGatewayWebhookUseCase(
    new StubVerifier(event),
    processedGatewayEventRepository,
    subscriptionRepository,
    new BindGatewayCustomerUseCase(subscriptionRepository, silentLogger),
    new SyncSubscriptionFromGatewayUseCase(
      subscriptionRepository,
      planRepository,
      inMemoryEventDispatcher,
      cancelSubscriptionUseCase,
      silentLogger
    ),
    cancelSubscriptionUseCase,
    new MarkSubscriptionPastDueUseCase(
      subscriptionRepository,
      inMemoryEventDispatcher
    ),
    new SyncPlanCatalogEntryUseCase(planRepository, silentLogger),
    new AnnounceTrialEndingUseCase(
      subscriptionRepository,
      inMemoryEventDispatcher,
      silentLogger
    ),
    silentLogger
  );
}

async function deliver(event: GatewayBillingEvent): Promise<void> {
  await makeWebhookUseCase(event).execute({
    raw_payload: "{}",
    signature: "sig",
  });
}

function stateChanged(
  overrides: Partial<SubscriptionStateChangedEvent>
): SubscriptionStateChangedEvent {
  return {
    type: "subscription_state_changed",
    event_id: `evt_${crypto.randomUUID()}`,
    occurred_at: new Date("2026-06-15T12:00:00.000Z"),
    external_reference: `sub_${crypto.randomUUID()}`,
    external_customer_reference: "cus_plan_choice",
    external_price_reference: PRO_PRICE_REFERENCE,
    status: "active",
    current_period_end: null,
    trial_end: null,
    ...overrides,
  };
}

async function setProPriceReference(reference: string | null): Promise<void> {
  const pro = await planRepository.planOfCode("pro");
  if (!pro) throw new Error("test setup: pro plan not seeded");
  await db
    .update(plansTable)
    .set({ external_price_reference: reference })
    .where(eq(plansTable.id, pro.id));
}

async function freeUserWithCustomer(
  email: string,
  customerReference: string
): Promise<User> {
  const { user } = await createUserFixture({
    name: "Conta Escolha Pelo Gateway",
    email,
    password: "password123",
  });
  const subscription = await subscriptionRepository.subscriptionOfUser(user.id);
  if (!subscription) throw new Error("test setup: no subscription");
  subscription.linkCustomer(customerReference);
  await subscriptionRepository.save(subscription);
  return user;
}

async function subscriptionOf(userId: string) {
  const subscription = await subscriptionRepository.subscriptionOfUser(userId);
  if (!subscription) throw new Error("test setup: no subscription");
  return subscription;
}

afterAll(async () => {
  await setProPriceReference(null);
});

describe("Initial plan choice recorded by the gateway webhook", () => {
  beforeEach(async () => {
    await truncate(TABLES);
    await setProPriceReference(PRO_PRICE_REFERENCE);
  });

  it("records the choice when a Pro trial starts", async () => {
    const user = await freeUserWithCustomer(
      "plan-choice.gateway.trial@sogio.dev",
      "cus_plan_choice_trial"
    );
    const occurredAt = new Date("2026-06-15T12:00:00.000Z");

    await deliver(
      stateChanged({
        external_customer_reference: "cus_plan_choice_trial",
        status: "trialing",
        trial_end: new Date("2026-06-29T12:00:00.000Z"),
        occurred_at: occurredAt,
      })
    );

    const subscription = await subscriptionOf(user.id);
    expect(subscription.status).toBe("trialing");
    expect(subscription.needs_plan_choice).toBe(false);
    expect(subscription.plan_chosen_at).toEqual(occurredAt);
  });

  it("records the choice when a paid subscription activates", async () => {
    const user = await freeUserWithCustomer(
      "plan-choice.gateway.active@sogio.dev",
      "cus_plan_choice_active"
    );
    const occurredAt = new Date("2026-06-15T12:00:00.000Z");

    await deliver(
      stateChanged({
        external_customer_reference: "cus_plan_choice_active",
        status: "active",
        current_period_end: new Date("2026-07-15T12:00:00.000Z"),
        occurred_at: occurredAt,
      })
    );

    const subscription = await subscriptionOf(user.id);
    expect(subscription.status).toBe("active");
    expect(subscription.needs_plan_choice).toBe(false);
    expect(subscription.plan_chosen_at).toEqual(occurredAt);
  });

  it("keeps an earlier choice when the gateway subscription starts later", async () => {
    const user = await freeUserWithCustomer(
      "plan-choice.gateway.earlier@sogio.dev",
      "cus_plan_choice_earlier"
    );
    const subscription = await subscriptionOf(user.id);
    const earlierChoice = new Date("2026-06-01T08:00:00.000Z");
    await subscriptionRepository.recordPlanChoiceIfAbsent(
      subscription.id,
      earlierChoice
    );

    await deliver(
      stateChanged({
        external_customer_reference: "cus_plan_choice_earlier",
        status: "active",
        current_period_end: new Date("2026-07-15T12:00:00.000Z"),
      })
    );

    const after = await subscriptionOf(user.id);
    expect(after.status).toBe("active");
    expect(after.plan_chosen_at).toEqual(earlierChoice);
  });

  it("does not record the choice when checkout completes before the subscription starts", async () => {
    const { user } = await createUserFixture({
      name: "Conta Checkout Concluido",
      email: "plan-choice.gateway.checkout-completed@sogio.dev",
      password: "password123",
    });

    await deliver({
      type: "checkout_completed",
      event_id: `evt_${crypto.randomUUID()}`,
      occurred_at: new Date(),
      user_id: user.id,
      external_customer_reference: "cus_plan_choice_checkout_completed",
      external_reference: null,
    });

    const subscription = await subscriptionOf(user.id);
    expect(subscription.external_customer_reference).toBe(
      "cus_plan_choice_checkout_completed"
    );
    expect(subscription.needs_plan_choice).toBe(true);
  });

  it("does not record the choice for an incomplete gateway subscription", async () => {
    const user = await freeUserWithCustomer(
      "plan-choice.gateway.incomplete@sogio.dev",
      "cus_plan_choice_incomplete"
    );

    await deliver(
      stateChanged({
        external_customer_reference: "cus_plan_choice_incomplete",
        status: "incomplete",
      })
    );

    expect((await subscriptionOf(user.id)).needs_plan_choice).toBe(true);
  });
});

describe("Initial plan choice outside the webhook", () => {
  beforeEach(async () => {
    await truncate(TABLES);
    await setProPriceReference(PRO_PRICE_REFERENCE);
  });

  it("is recorded when a plan is granted", async () => {
    const { user } = await createUserFixture({
      name: "Conta Plano Concedido",
      email: "plan-choice.grant@sogio.dev",
      password: "password123",
    });
    const useCase = new GrantPlanUseCase(
      subscriptionRepository,
      planRepository,
      inMemoryEventDispatcher
    );

    await useCase.execute({ plan_code: "pro" }, user);

    const subscription = await subscriptionOf(user.id);
    expect(subscription.needs_plan_choice).toBe(false);
  });

  it("is not recorded by creating a checkout session, so abandoning checkout keeps it pending", async () => {
    const { user } = await createUserFixture({
      name: "Conta Checkout Abandonado",
      email: "plan-choice.checkout-abandoned@sogio.dev",
      password: "password123",
    });
    const useCase = new CreateCheckoutSessionUseCase(
      subscriptionRepository,
      planRepository,
      new StubPaymentGateway(),
      "http://localhost:5173"
    );

    await useCase.execute({ plan_code: "pro", return_to: "onboarding" }, user);

    const subscription = await subscriptionOf(user.id);
    expect(subscription.external_customer_reference).toBe(
      `cus_stub_${user.id}`
    );
    expect(subscription.needs_plan_choice).toBe(true);
  });
});
