import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";

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
      email: "joao@stayhub.dev",
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
      email: "joao@stayhub.dev",
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
      email: "joao@stayhub.dev",
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
      email: "user1@stayhub.dev",
      password: "password123",
    });
    const { user: user2 } = await createUserFixture({
      name: "Usuário Dois",
      email: "user2@stayhub.dev",
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
      email: "joao@stayhub.dev",
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
});
