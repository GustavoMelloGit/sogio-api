import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";

describe("POST /auth/sign-in", () => {
  beforeEach(async () => {
    await truncate(["users"]);
  });

  it("200 — returns token and user on valid credentials", async () => {
    const { user, plainPassword } = await createUserFixture({
      name: "Ada Lovelace",
      email: "ada@sogio.dev",
      password: "correct-horse-battery",
    });

    const res = await api("/auth/sign-in", {
      method: "POST",
      body: JSON.stringify({ email: user.email, password: plainPassword }),
    });
    const body = (await res.json()) as {
      token: string;
      user: Record<string, unknown>;
    };

    expect(res.status).toBe(200);
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
    expect(body.user).toBeDefined();
    expect(typeof body.user.id).toBe("string");
    expect(typeof body.user.name).toBe("string");
    expect(typeof body.user.email).toBe("string");
    expect(typeof body.user.created_at).toBe("string");
    expect(typeof body.user.updated_at).toBe("string");
    expect(body.user.email).toBe(user.email);
    expect(body.user.password).toBeUndefined();
  });

  it("401 — rejects wrong password", async () => {
    const { user } = await createUserFixture({
      name: "Ada Lovelace",
      email: "ada@sogio.dev",
      password: "correct-horse-battery",
    });

    const res = await api("/auth/sign-in", {
      method: "POST",
      body: JSON.stringify({ email: user.email, password: "wrong-password" }),
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(body.token).toBeUndefined();
  });

  it("401 — rejects unknown email with same message as wrong password", async () => {
    await createUserFixture({
      name: "Ada Lovelace",
      email: "ada@sogio.dev",
      password: "correct-horse-battery",
    });

    const resWrongPassword = await api("/auth/sign-in", {
      method: "POST",
      body: JSON.stringify({
        email: "ada@sogio.dev",
        password: "wrong-password",
      }),
    });
    const bodyWrongPassword = (await resWrongPassword.json()) as Record<
      string,
      unknown
    >;

    const resUnknownEmail = await api("/auth/sign-in", {
      method: "POST",
      body: JSON.stringify({
        email: "ghost@sogio.dev",
        password: "any-password",
      }),
    });
    const bodyUnknownEmail = (await resUnknownEmail.json()) as Record<
      string,
      unknown
    >;

    expect(resUnknownEmail.status).toBe(401);
    expect(bodyUnknownEmail.token).toBeUndefined();
    expect(bodyUnknownEmail.message).toBe(bodyWrongPassword.message);
  });

  it("422 — rejects empty body", async () => {
    const res = await api("/auth/sign-in", {
      method: "POST",
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(422);
  });
});
