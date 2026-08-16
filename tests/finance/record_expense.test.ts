import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { db } from "../../src/core/infra/database/drizzle/database";
import { ledgerEntriesTable } from "../../src/core/infra/database/drizzle/schema";

const TABLES = ["ledger_entries", "properties", "addresses", "users"];

const validBody = {
  amount: 15000,
  description: "Manutenção do ar-condicionado",
  category: "MANUTENÇÃO",
};

describe("POST /finance/:property_id/expense", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("204 — records expense for a property owned by the user", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const res = await api(`/finance/${property.id}/expense`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(204);
  });

  it("401 — rejects request without auth token", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const res = await api(`/finance/${property.id}/expense`, {
      method: "POST",
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(401);
  });

  it("404 — rejects non-existent property_id", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);
    const fakePropertyId = crypto.randomUUID();

    const res = await api(`/finance/${fakePropertyId}/expense`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(404);
  });

  it("404 — rejects property belonging to another user", async () => {
    const { user: user1 } = await createUserFixture({
      name: "Usuário Um",
      email: "user1@sogio.dev",
      password: "password123",
    });
    const { user: user2 } = await createUserFixture({
      name: "Usuário Dois",
      email: "user2@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user1.id });
    const token = await createAuthToken(user2.id);

    const res = await api(`/finance/${property.id}/expense`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(404);
  });

  it("422 — rejects empty body", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const res = await api(`/finance/${property.id}/expense`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(422);
  });

  it("422 — rejects category outside the closed vocabulary", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const res = await api(`/finance/${property.id}/expense`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({ ...validBody, category: "CATEGORIA_INVALIDA" }),
    });

    expect(res.status).toBe(422);
  });

  it("200 — reads a historical movement with a category outside the closed vocabulary", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    await db.insert(ledgerEntriesTable).values({
      id: crypto.randomUUID(),
      amount: -5000,
      description: "Lançamento legado",
      category: "CATEGORIA_LEGADA",
      property_id: property.id,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const res = await api(`/finance/properties/${property.id}/movements`, {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { category: string }[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.category).toBe("CATEGORIA_LEGADA");
  });
});
