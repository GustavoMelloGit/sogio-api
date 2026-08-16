import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import {
  createUserFixture,
  createAdminFixture,
} from "../helpers/fixtures/user";
import { createAuthToken } from "../helpers/fixtures/auth_token";

const TABLES = ["app_settings", "users"];

type AppSettingDto = {
  id: string;
  key: string;
  value: unknown;
  type: "string" | "number" | "boolean" | "json";
  description: string | null;
  created_at: string;
  updated_at: string;
};

async function createAuthTokenForNewUser(): Promise<string> {
  const { user } = await createUserFixture({
    name: "Settings User",
    email: `settings-user-${crypto.randomUUID()}@sogio.dev`,
    password: "password123",
  });
  return createAuthToken(user.id, "user");
}

async function createAuthTokenForAdmin(): Promise<string> {
  const { user } = await createAdminFixture({
    name: "Settings Admin",
    email: `settings-admin-${crypto.randomUUID()}@sogio.dev`,
    password: "password123",
  });
  return createAuthToken(user.id, "admin");
}

async function createSetting(
  token: string,
  body: Record<string, unknown>
): Promise<Response> {
  return api("/settings", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: JSON.stringify(body),
  });
}

describe("POST /settings", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("200 — admin creates setting with type: string", async () => {
    const token = await createAuthTokenForAdmin();

    const res = await createSetting(token, {
      key: "app.name",
      value: "Sogio",
      type: "string",
    });
    const body = (await res.json()) as AppSettingDto;

    expect(res.status).toBe(200);
    expect(typeof body.id).toBe("string");
    expect(body.key).toBe("app.name");
    expect(body.value).toBe("Sogio");
    expect(body.type).toBe("string");
    expect(body.description).toBeNull();
    expect(typeof body.created_at).toBe("string");
    expect(typeof body.updated_at).toBe("string");
  });

  it("200 — admin creates setting with type: number", async () => {
    const token = await createAuthTokenForAdmin();

    const res = await createSetting(token, {
      key: "app.max_guests",
      value: 10,
      type: "number",
    });
    const body = (await res.json()) as AppSettingDto;

    expect(res.status).toBe(200);
    expect(body.key).toBe("app.max_guests");
    expect(body.value).toBe(10);
    expect(body.type).toBe("number");
  });

  it("200 — admin creates setting with type: boolean", async () => {
    const token = await createAuthTokenForAdmin();

    const res = await createSetting(token, {
      key: "feature.dark_mode",
      value: true,
      type: "boolean",
    });
    const body = (await res.json()) as AppSettingDto;

    expect(res.status).toBe(200);
    expect(body.key).toBe("feature.dark_mode");
    expect(body.value).toBe(true);
    expect(body.type).toBe("boolean");
  });

  it("200 — admin creates setting with type: json (object)", async () => {
    const token = await createAuthTokenForAdmin();

    const jsonValue = { theme: "dark", locale: "pt-BR" };
    const res = await createSetting(token, {
      key: "app.config",
      value: jsonValue,
      type: "json",
    });
    const body = (await res.json()) as AppSettingDto;

    expect(res.status).toBe(200);
    expect(body.key).toBe("app.config");
    expect(body.type).toBe("json");
    expect(body.value).toEqual(jsonValue);
  });

  it("403 — user role receives 403 on POST /settings", async () => {
    const token = await createAuthTokenForNewUser();

    const res = await createSetting(token, {
      key: "app.name",
      value: "Sogio",
      type: "string",
    });

    expect(res.status).toBe(403);
  });

  it("403 — token with forged admin role is rejected when user is 'user' in db", async () => {
    const { user } = await createUserFixture({
      name: "Forged Role User",
      email: `forged-role-${crypto.randomUUID()}@sogio.dev`,
      password: "password123",
    });
    const forgedToken = await createAuthToken(user.id, "admin");

    const res = await createSetting(forgedToken, {
      key: "app.name",
      value: "Sogio",
      type: "string",
    });

    expect(res.status).toBe(403);
  });

  it("409 — admin rejects duplicate key", async () => {
    const token = await createAuthTokenForAdmin();

    const firstRes = await createSetting(token, {
      key: "app.name",
      value: "Sogio",
      type: "string",
    });
    expect(firstRes.status).toBe(200);

    const secondRes = await createSetting(token, {
      key: "app.name",
      value: "AnotherValue",
      type: "string",
    });

    expect(secondRes.status).toBe(409);
  });

  it("401 — rejects request without token", async () => {
    const res = await api("/settings", {
      method: "POST",
      body: JSON.stringify({
        key: "app.name",
        value: "Sogio",
        type: "string",
      }),
    });

    expect(res.status).toBe(401);
  });

  it("422 — empty body is rejected (boundedJsonValue with undefined returns validation error)", async () => {
    const token = await createAuthTokenForAdmin();

    const res = await api("/settings", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(422);
  });

  it("422 — rejects invalid type", async () => {
    const token = await createAuthTokenForAdmin();

    const res = await createSetting(token, {
      key: "app.name",
      value: "Sogio",
      type: "invalid_type",
    });

    expect(res.status).toBe(422);
  });

  it("422 — rejects value incompatible with type (number type, string value)", async () => {
    const token = await createAuthTokenForAdmin();

    const res = await createSetting(token, {
      key: "app.max_guests",
      value: "texto",
      type: "number",
    });

    expect(res.status).toBe(422);
  });

  it("422 — rejects extra field in body (.strict())", async () => {
    const token = await createAuthTokenForAdmin();

    const res = await createSetting(token, {
      key: "app.name",
      value: "Sogio",
      type: "string",
      unknown_field: true,
    });

    expect(res.status).toBe(422);
  });

  it("422 — rejects value exceeding 16KB", async () => {
    const token = await createAuthTokenForAdmin();

    const bigValue = "a".repeat(16385);
    const res = await createSetting(token, {
      key: "app.big",
      value: bigValue,
      type: "string",
    });

    expect(res.status).toBe(422);
  });
});

describe("GET /settings/:id", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("200 — returns setting by id (user role)", async () => {
    const adminToken = await createAuthTokenForAdmin();
    const userToken = await createAuthTokenForNewUser();

    const createRes = await createSetting(adminToken, {
      key: "app.name",
      value: "Sogio",
      type: "string",
    });
    const created = (await createRes.json()) as AppSettingDto;
    expect(createRes.status).toBe(200);

    const res = await api(`/settings/${created.id}`, {
      headers: { Authorization: "Bearer " + userToken },
    });
    const body = (await res.json()) as AppSettingDto;

    expect(res.status).toBe(200);
    expect(body.id).toBe(created.id);
    expect(body.key).toBe("app.name");
    expect(body.value).toBe("Sogio");
    expect(body.type).toBe("string");
  });

  it("401 — rejects request without token", async () => {
    const res = await api(`/settings/${crypto.randomUUID()}`);

    expect(res.status).toBe(401);
  });

  it("404 — returns 404 for non-existent id", async () => {
    const token = await createAuthTokenForNewUser();

    const res = await api(`/settings/${crypto.randomUUID()}`, {
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(404);
  });
});

describe("GET /settings/key/:key", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("200 — returns setting by key (user role)", async () => {
    const adminToken = await createAuthTokenForAdmin();
    const userToken = await createAuthTokenForNewUser();

    const createRes = await createSetting(adminToken, {
      key: "feature.dark_mode",
      value: false,
      type: "boolean",
    });
    expect(createRes.status).toBe(200);

    const res = await api("/settings/key/feature.dark_mode", {
      headers: { Authorization: "Bearer " + userToken },
    });
    const body = (await res.json()) as AppSettingDto;

    expect(res.status).toBe(200);
    expect(body.key).toBe("feature.dark_mode");
    expect(body.value).toBe(false);
    expect(body.type).toBe("boolean");
  });

  it("401 — rejects request without token", async () => {
    const res = await api("/settings/key/some.key");

    expect(res.status).toBe(401);
  });

  it("404 — returns 404 for non-existent key", async () => {
    const token = await createAuthTokenForNewUser();

    const res = await api("/settings/key/nonexistent.key", {
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(404);
  });
});

describe("GET /settings", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("200 — returns paginated list with metadata (user role)", async () => {
    const adminToken = await createAuthTokenForAdmin();
    const userToken = await createAuthTokenForNewUser();

    await createSetting(adminToken, {
      key: "app.name",
      value: "Sogio",
      type: "string",
    });
    await createSetting(adminToken, {
      key: "app.version",
      value: "1.0.0",
      type: "string",
    });

    const res = await api("/settings", {
      headers: { Authorization: "Bearer " + userToken },
    });
    const body = (await res.json()) as {
      data: AppSettingDto[];
      pagination: {
        page: number;
        limit: number;
        total: number;
        total_pages: number;
        has_next: boolean;
        has_previous: boolean;
      };
    };

    expect(res.status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    expect(typeof body.pagination.page).toBe("number");
    expect(typeof body.pagination.limit).toBe("number");
    expect(typeof body.pagination.total).toBe("number");
    expect(typeof body.pagination.total_pages).toBe("number");
    expect(typeof body.pagination.has_next).toBe("boolean");
    expect(typeof body.pagination.has_previous).toBe("boolean");
  });

  it("401 — rejects request without token", async () => {
    const res = await api("/settings");

    expect(res.status).toBe(401);
  });
});

describe("PUT /settings/:id", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("200 — admin updates value and description", async () => {
    const token = await createAuthTokenForAdmin();

    const createRes = await createSetting(token, {
      key: "app.name",
      value: "OldName",
      type: "string",
    });
    const created = (await createRes.json()) as AppSettingDto;
    expect(createRes.status).toBe(200);

    const res = await api(`/settings/${created.id}`, {
      method: "PUT",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({ value: "NewName", description: "Updated name" }),
    });
    const body = (await res.json()) as AppSettingDto;

    expect(res.status).toBe(200);
    expect(body.id).toBe(created.id);
    expect(body.key).toBe("app.name");
    expect(body.value).toBe("NewName");
    expect(body.description).toBe("Updated name");
  });

  it("403 — user role receives 403 on PUT /settings/:id", async () => {
    const adminToken = await createAuthTokenForAdmin();
    const userToken = await createAuthTokenForNewUser();

    const createRes = await createSetting(adminToken, {
      key: "app.name",
      value: "OldName",
      type: "string",
    });
    const created = (await createRes.json()) as AppSettingDto;
    expect(createRes.status).toBe(200);

    const res = await api(`/settings/${created.id}`, {
      method: "PUT",
      headers: { Authorization: "Bearer " + userToken },
      body: JSON.stringify({ value: "NewName" }),
    });

    expect(res.status).toBe(403);
  });

  it("422 — rejects attempt to change key (.strict())", async () => {
    const token = await createAuthTokenForAdmin();

    const createRes = await createSetting(token, {
      key: "app.name",
      value: "Sogio",
      type: "string",
    });
    const created = (await createRes.json()) as AppSettingDto;
    expect(createRes.status).toBe(200);

    const res = await api(`/settings/${created.id}`, {
      method: "PUT",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({ key: "new.key", value: "Sogio" }),
    });

    expect(res.status).toBe(422);
  });

  it("401 — rejects request without token", async () => {
    const res = await api(`/settings/${crypto.randomUUID()}`, {
      method: "PUT",
      body: JSON.stringify({ value: "test" }),
    });

    expect(res.status).toBe(401);
  });

  it("404 — admin gets 404 for non-existent id", async () => {
    const token = await createAuthTokenForAdmin();

    const res = await api(`/settings/${crypto.randomUUID()}`, {
      method: "PUT",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({ value: "test" }),
    });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /settings/:id", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("204 — admin soft deletes setting successfully", async () => {
    const token = await createAuthTokenForAdmin();

    const createRes = await createSetting(token, {
      key: "app.name",
      value: "Sogio",
      type: "string",
    });
    const created = (await createRes.json()) as AppSettingDto;
    expect(createRes.status).toBe(200);

    const res = await api(`/settings/${created.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(204);
  });

  it("403 — user role receives 403 on DELETE /settings/:id", async () => {
    const adminToken = await createAuthTokenForAdmin();
    const userToken = await createAuthTokenForNewUser();

    const createRes = await createSetting(adminToken, {
      key: "app.name",
      value: "Sogio",
      type: "string",
    });
    const created = (await createRes.json()) as AppSettingDto;
    expect(createRes.status).toBe(200);

    const res = await api(`/settings/${created.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + userToken },
    });

    expect(res.status).toBe(403);
  });

  it("401 — rejects request without token", async () => {
    const res = await api(`/settings/${crypto.randomUUID()}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(401);
  });

  it("404 — admin gets 404 for non-existent id", async () => {
    const token = await createAuthTokenForAdmin();

    const res = await api(`/settings/${crypto.randomUUID()}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(404);
  });

  it("404 — deleted setting is not found (soft delete confirmed)", async () => {
    const adminToken = await createAuthTokenForAdmin();
    const userToken = await createAuthTokenForNewUser();

    const createRes = await createSetting(adminToken, {
      key: "app.name",
      value: "Sogio",
      type: "string",
    });
    const created = (await createRes.json()) as AppSettingDto;
    expect(createRes.status).toBe(200);

    const deleteRes = await api(`/settings/${created.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + adminToken },
    });
    expect(deleteRes.status).toBe(204);

    const getRes = await api(`/settings/${created.id}`, {
      headers: { Authorization: "Bearer " + userToken },
    });

    expect(getRes.status).toBe(404);
  });
});
