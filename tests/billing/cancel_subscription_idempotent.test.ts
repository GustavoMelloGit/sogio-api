import { describe, it, expect, beforeEach } from "bun:test";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { CancelSubscriptionUseCase } from "../../src/billing/application/use_case/cancel_subscription";
import { GrantPlanUseCase } from "../../src/billing/application/use_case/grant_plan";
import { SubscriptionPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";
import { PlanPostgresRepository } from "../../src/billing/infra/database/postgres_repository/plan_postgres_repository";
import { inMemoryEventDispatcher } from "../../src/core/infra/event/in_memory_event_dispatcher";
import { SubscriptionCanceledEvent } from "../../src/billing/domain/event/subscription_canceled_event";
import type { EventHandler } from "../../src/core/application/event/event_handler";

const TABLES = ["properties", "addresses", "users"];

const subscriptionRepository = new SubscriptionPostgresRepository();
const planRepository = new PlanPostgresRepository();
const grantPlanUseCase = new GrantPlanUseCase(
  subscriptionRepository,
  planRepository,
  inMemoryEventDispatcher
);

describe("CancelSubscriptionUseCase — idempotent (§2.4 rule 2, DA-10)", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("does not throw and does not publish a second SubscriptionCanceledEvent on reentry", async () => {
    const { user } = await createUserFixture({
      name: "Conta Cancelamento Idempotente",
      email: "cancel.idempotent@sogio.dev",
      password: "password123",
    });

    await grantPlanUseCase.execute({ plan_code: "pro" }, user);

    const captured: SubscriptionCanceledEvent[] = [];
    inMemoryEventDispatcher.register(SubscriptionCanceledEvent.NAME, {
      async handle(event) {
        captured.push(event as SubscriptionCanceledEvent);
      },
    } satisfies EventHandler<SubscriptionCanceledEvent>);

    const useCase = new CancelSubscriptionUseCase(
      subscriptionRepository,
      planRepository,
      inMemoryEventDispatcher
    );

    await useCase.execute({ user_id: user.id });
    const second = await useCase.execute({ user_id: user.id });
    expect(second.status).toBe("canceled");

    const eventsForUser = captured.filter(e => e.user_id === user.id);
    expect(eventsForUser).toHaveLength(1);
  });
});

describe("CancelSubscriptionUseCase — perpetual plan guard (security review B-3)", () => {
  it("is a silent no-op instead of throwing when the resolved subscription is on a perpetual plan", async () => {
    const { user } = await createUserFixture({
      name: "Conta Free Cancelamento Guardado",
      email: "cancel.perpetual-guard@sogio.dev",
      password: "password123",
    });

    const captured: SubscriptionCanceledEvent[] = [];
    inMemoryEventDispatcher.register(SubscriptionCanceledEvent.NAME, {
      async handle(event) {
        captured.push(event as SubscriptionCanceledEvent);
      },
    } satisfies EventHandler<SubscriptionCanceledEvent>);

    const useCase = new CancelSubscriptionUseCase(
      subscriptionRepository,
      planRepository,
      inMemoryEventDispatcher
    );

    // User never subscribed to anything paid — stays on the perpetual Free
    // plan. A webhook-driven cancel must not throw ConflictError here.
    const result = await useCase.execute({ user_id: user.id });
    expect(result.status).toBe("active");

    const reloaded = await subscriptionRepository.subscriptionOfUser(user.id);
    expect(reloaded?.status).toBe("active");

    const eventsForUser = captured.filter(e => e.user_id === user.id);
    expect(eventsForUser).toHaveLength(0);
  });
});
