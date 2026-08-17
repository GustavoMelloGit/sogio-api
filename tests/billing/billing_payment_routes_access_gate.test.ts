import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { blockUser } from "../helpers/block_user";
import { PlanPostgresRepository } from "../../src/billing/infra/database/postgres_repository/plan_postgres_repository";
import { db } from "../../src/core/infra/database/drizzle/database";
import { plansTable } from "../../src/core/infra/database/drizzle/schema";
import { eq } from "drizzle-orm";

const TABLES = ["properties", "addresses", "users"];
const planRepository = new PlanPostgresRepository();

async function clearProPriceReference(): Promise<void> {
  const pro = await planRepository.planOfCode("pro");
  if (!pro) throw new Error("test setup: pro plan not seeded");
  await db
    .update(plansTable)
    .set({ external_price_reference: null })
    .where(eq(plansTable.id, pro.id));
}

describe("Payment routes — exempt from the platform-access gate (DA-5, R-2)", () => {
  beforeEach(async () => {
    await truncate(TABLES);
    await clearProPriceReference();
  });

  it("never returns 403 on POST /billing/checkout-session for a blocked account (item i)", async () => {
    const { user } = await createUserFixture({
      name: "Conta Bloqueada Checkout",
      email: "gate.checkout.blocked@sogio.dev",
      password: "password123",
    });
    await blockUser(user.id);
    const token = await createAuthToken(user.id);

    const res = await api("/billing/checkout-session", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({ plan_code: "pro" }),
    });

    // The plan has no external_price_reference in this test, so the use
    // case itself fails with a typed 500 (item j) — the point is that this
    // 500 comes from the use case, and the platform-access gate never got
    // a chance to short-circuit it with a 403 first.
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(500);
  });

  it("never returns 403 on POST /billing/portal-session for a blocked account (item i)", async () => {
    const { user } = await createUserFixture({
      name: "Conta Bloqueada Portal",
      email: "gate.portal.blocked@sogio.dev",
      password: "password123",
    });
    await blockUser(user.id);
    const token = await createAuthToken(user.id);

    const res = await api("/billing/portal-session", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    });

    // No gateway customer yet, so the use case itself returns 409 — again,
    // the point is that this 409 comes from the use case, never a 403 from
    // the gate.
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(409);
  });
});

describe("POST /billing/checkout-session — misconfigured plan (item j)", () => {
  beforeEach(async () => {
    await truncate(TABLES);
    await clearProPriceReference();
  });

  it("returns a typed 500, not a silent failure, when the plan has no external_price_reference", async () => {
    const { user } = await createUserFixture({
      name: "Conta Checkout Rota Sem Preco",
      email: "route.checkout.no-price@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);

    const res = await api("/billing/checkout-session", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({ plan_code: "pro" }),
    });

    expect(res.status).toBe(500);
  });
});
