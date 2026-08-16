import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createAuthToken } from "../helpers/fixtures/auth_token";

describe("POST /auth/change-password", () => {
  beforeEach(async () => {
    await truncate(["users"]);
  });

  it("401 — without a bearer token", async () => {
    const res = await api("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: "whatever",
        newPassword: "NovaSenha123",
      }),
    });

    expect(res.status).toBe(401);
  });

  it("401 — rejects an incorrect current password", async () => {
    const { user } = await createUserFixture({
      name: "Ada Lovelace",
      email: "ada@sogio.dev",
      password: "correct-horse-battery",
    });
    const token = await createAuthToken(user.id);

    const res = await api("/auth/change-password", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({
        currentPassword: "wrong-password",
        newPassword: "NovaSenha123",
      }),
    });

    expect(res.status).toBe(401);
  });

  it("422 — rejects a new password identical to the current one", async () => {
    const { user } = await createUserFixture({
      name: "Ada Lovelace",
      email: "ada@sogio.dev",
      password: "correct-horse-battery",
    });
    const token = await createAuthToken(user.id);

    const res = await api("/auth/change-password", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({
        currentPassword: "correct-horse-battery",
        newPassword: "correct-horse-battery",
      }),
    });

    expect(res.status).toBe(422);
  });

  it("204 — changes the password and allows signing in with the new one, not the old one", async () => {
    const { user } = await createUserFixture({
      name: "Ada Lovelace",
      email: "ada@sogio.dev",
      password: "correct-horse-battery",
    });
    const token = await createAuthToken(user.id);

    const res = await api("/auth/change-password", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({
        currentPassword: "correct-horse-battery",
        newPassword: "NovaSenha123",
      }),
    });

    expect(res.status).toBe(204);

    const signInWithNewPassword = await api("/auth/sign-in", {
      method: "POST",
      body: JSON.stringify({ email: user.email, password: "NovaSenha123" }),
    });
    expect(signInWithNewPassword.status).toBe(200);

    const signInWithOldPassword = await api("/auth/sign-in", {
      method: "POST",
      body: JSON.stringify({
        email: user.email,
        password: "correct-horse-battery",
      }),
    });
    expect(signInWithOldPassword.status).toBe(401);
  });

  it("does not enforce an attempt limit beyond the route's own rate limit", async () => {
    const { user } = await createUserFixture({
      name: "Ada Lovelace",
      email: "ada@sogio.dev",
      password: "correct-horse-battery",
    });
    const token = await createAuthToken(user.id);

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await api("/auth/change-password", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: JSON.stringify({
          currentPassword: "wrong-password",
          newPassword: "NovaSenha123",
        }),
      });
      expect(res.status).toBe(401);
    }

    const res = await api("/auth/change-password", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({
        currentPassword: "correct-horse-battery",
        newPassword: "NovaSenha123",
      }),
    });

    expect(res.status).toBe(204);
  });
});
