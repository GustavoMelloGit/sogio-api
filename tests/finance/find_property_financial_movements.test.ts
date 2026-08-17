import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";

const TABLES = ["ledger_entries", "properties", "addresses", "users"];

describe("GET /finance/properties/:property_id/movements", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("200 — returns the movements of a property owned by the user", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    await api(`/finance/${property.id}/revenue`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({
        amount: 250000,
        description: "Pagamento da hospedagem",
        category: "ESTADIA",
      }),
    });

    const res = await api(`/finance/properties/${property.id}/movements`, {
      headers: { Authorization: "Bearer " + token },
    });
    const body = (await res.json()) as {
      data: Array<{ property_id: string }>;
    };

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.property_id).toBe(property.id);
  });

  it("401 — rejects request without auth token", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const res = await api(`/finance/properties/${property.id}/movements`);

    expect(res.status).toBe(401);
  });

  it("404 — rejects a nonexistent property", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);

    const res = await api(
      `/finance/properties/${crypto.randomUUID()}/movements`,
      { headers: { Authorization: "Bearer " + token } }
    );

    expect(res.status).toBe(404);
  });

  /**
   * R-1: before this fix, `FindPropertyFinancialMovementsController` never
   * received `user` and the use case never checked ownership at all — any
   * authenticated user could read any property's full financial history by
   * guessing/knowing its UUID. This is the regression test for that IDOR.
   */
  it("404 — rejects a property belonging to another user (R-1 IDOR regression)", async () => {
    const { user: owner } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const { user: attacker } = await createUserFixture({
      name: "Maria Souza",
      email: "maria@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: owner.id });
    const ownerToken = await createAuthToken(owner.id);

    await api(`/finance/${property.id}/revenue`, {
      method: "POST",
      headers: { Authorization: "Bearer " + ownerToken },
      body: JSON.stringify({
        amount: 999999,
        description: "Dado financeiro sensível do proprietário",
        category: "ESTADIA",
      }),
    });

    const attackerToken = await createAuthToken(attacker.id);
    const res = await api(`/finance/properties/${property.id}/movements`, {
      headers: { Authorization: "Bearer " + attackerToken },
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("data");
  });
});
