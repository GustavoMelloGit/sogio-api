import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";

const TABLES = ["stays", "tenants", "properties", "addresses", "users"];

const validBody = {
  guests: 2,
  entrance_code: "1234567",
  check_in: "2040-06-01T12:00:00.000Z",
  check_out: "2040-06-03T12:00:00.000Z",
  price: 10000,
  source: "DIRECT",
  tenant: {
    name: "Ana Souza",
    phone: "5511999990001",
    sex: "FEMALE",
  },
};

describe("POST /booking/property/:property_id/book", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("200 — creates stay with new tenant", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@stayhub.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const res = await api(`/booking/property/${property.id}/book`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify(validBody),
    });
    const body = (await res.json()) as {
      message: string;
      data: Record<string, unknown>;
    };

    expect(res.status).toBe(200);
    expect(body.message).toBe("Stay created successfully");
    expect(typeof body.data.id).toBe("string");
    expect(typeof body.data.tenant_id).toBe("string");
    expect(body.data.entrance_code).toBe(validBody.entrance_code);
    expect(body.data.guests).toBe(validBody.guests);
    expect(body.data.price).toBe(validBody.price);
    expect(typeof body.data.check_in).toBe("string");
    expect(typeof body.data.check_out).toBe("string");
  });

  it("200 — generates entrance_code when not provided", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@stayhub.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const bodyWithoutEntranceCode: Record<string, unknown> = {
      ...validBody,
    };
    delete bodyWithoutEntranceCode.entrance_code;

    const res = await api(`/booking/property/${property.id}/book`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify(bodyWithoutEntranceCode),
    });
    const body = (await res.json()) as {
      message: string;
      data: Record<string, unknown>;
    };

    expect(res.status).toBe(200);
    expect(typeof body.data.entrance_code).toBe("string");
    expect((body.data.entrance_code as string).length).toBe(7);
    expect(body.data.entrance_code).not.toBe(validBody.entrance_code);
  });

  it("200 — reuses existing tenant", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@stayhub.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const firstRes = await api(`/booking/property/${property.id}/book`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify(validBody),
    });
    const firstBody = (await firstRes.json()) as {
      data: Record<string, unknown>;
    };

    expect(firstRes.status).toBe(200);

    const secondRes = await api(`/booking/property/${property.id}/book`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({
        ...validBody,
        check_in: "2040-07-01T12:00:00.000Z",
        check_out: "2040-07-03T12:00:00.000Z",
      }),
    });
    const secondBody = (await secondRes.json()) as {
      data: Record<string, unknown>;
    };

    expect(secondRes.status).toBe(200);
    expect(secondBody.data.tenant_id).toBe(firstBody.data.tenant_id);
  });

  it("401 — rejects request without auth token", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@stayhub.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const res = await api(`/booking/property/${property.id}/book`, {
      method: "POST",
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(401);
  });

  it("401 — rejects request with invalid token", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@stayhub.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const res = await api(`/booking/property/${property.id}/book`, {
      method: "POST",
      headers: { Authorization: "Bearer invalid-token" },
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

    const res = await api(`/booking/property/${fakePropertyId}/book`, {
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

    const res = await api(`/booking/property/${property.id}/book`, {
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

    const res = await api(`/booking/property/${property.id}/book`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(422);
  });

  it("422 — rejects guests exceeding property capacity", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@stayhub.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({
      userId: user.id,
      capacity: 2,
    });
    const token = await createAuthToken(user.id);

    const res = await api(`/booking/property/${property.id}/book`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({ ...validBody, guests: 5 }),
    });

    expect(res.status).toBe(422);
  });

  it("422 — rejects check_in equal to check_out", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@stayhub.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const res = await api(`/booking/property/${property.id}/book`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({
        ...validBody,
        check_in: "2040-06-01T12:00:00.000Z",
        check_out: "2040-06-01T12:00:00.000Z",
      }),
    });

    expect(res.status).toBe(422);
  });

  it("409 — rejects overlapping dates for the same property", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@stayhub.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const firstRes = await api(`/booking/property/${property.id}/book`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify(validBody),
    });

    expect(firstRes.status).toBe(200);

    const secondRes = await api(`/booking/property/${property.id}/book`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({
        ...validBody,
        check_in: "2040-06-02T12:00:00.000Z",
        check_out: "2040-06-04T12:00:00.000Z",
      }),
    });

    expect(secondRes.status).toBe(409);
  });
});
