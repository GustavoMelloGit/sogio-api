import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { SubscriptionPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";
import { PlanPostgresRepository } from "../../src/billing/infra/database/postgres_repository/plan_postgres_repository";

const TABLES = ["users"];

describe("POST /auth/users — billing side effect", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("provisions an active Free subscription for a newly registered user (DA-7)", async () => {
    const res = await api("/auth/users", {
      method: "POST",
      body: JSON.stringify({
        name: "Nova Conta",
        email: "nova.conta@sogio.dev",
        password: "password123",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string } };

    const subscriptionRepository = new SubscriptionPostgresRepository();
    const planRepository = new PlanPostgresRepository();

    const subscription = await subscriptionRepository.subscriptionOfUser(
      body.user.id
    );
    const freePlan = await planRepository.planOfCode("free");

    expect(subscription).not.toBeNull();
    expect(subscription?.plan_id).toBe(freePlan?.id);
    expect(subscription?.status).toBe("active");
    expect(subscription?.current_period_end).toBeNull();
  });
});
