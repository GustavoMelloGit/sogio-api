import { describe, it, expect, beforeEach } from "bun:test";
import { api, readSetCookie, readSetCookieAttributes } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { env } from "../../src/core/infra/config/environments";
import { db } from "../../src/core/infra/database/drizzle/database";
import {
  passwordResetRequestsTable,
  sessionsTable,
} from "../../src/core/infra/database/drizzle/schema";
import { eq } from "drizzle-orm";
import { CryptoDelegatedSecretService } from "../../src/auth/infra/service/crypto_delegated_secret_service";

const COOKIE = env.SESSION_COOKIE_NAME;
const ALLOWED_ORIGIN = "http://localhost:5173";

const password = "SenhaForte123";

async function signIn(email: string) {
  return api("/auth/sign-in", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

async function signInToken(email: string): Promise<string> {
  const body = (await (await signIn(email)).json()) as { token: string };

  return body.token;
}

describe("Session in a cookie", () => {
  beforeEach(async () => {
    await truncate(["sessions", "password_reset_requests", "users"]);
  });

  it("sign-in sets an httpOnly cookie and still returns the secret in the body", async () => {
    const email = `cookie-${crypto.randomUUID()}@sogio.dev`;
    await createUserFixture({ name: "Cookie User", email, password });

    const response = await signIn(email);
    const body = (await response.json()) as { token: string };

    expect(response.status).toBe(200);
    expect(typeof body.token).toBe("string");
    expect(readSetCookie(response, COOKIE)).toBe(body.token);

    const attributes = readSetCookieAttributes(response, COOKIE) ?? "";
    expect(attributes).toContain("HttpOnly");
    expect(attributes).toContain("SameSite=Lax");
    expect(attributes).toContain("Path=/");
  });

  it("the cookie authenticates, and so does the same secret as a bearer token", async () => {
    const email = `both-${crypto.randomUUID()}@sogio.dev`;
    await createUserFixture({ name: "Both Ways", email, password });

    const token = await signInToken(email);

    const byCookie = await api("/auth/me", {
      headers: { Cookie: `${COOKIE}=${token}` },
    });
    const byHeader = await api("/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(byCookie.status).toBe(200);
    expect(byHeader.status).toBe(200);
  });

  it("only the secret's digest reaches the database", async () => {
    const email = `digest-${crypto.randomUUID()}@sogio.dev`;
    await createUserFixture({ name: "Digest User", email, password });

    const token = await signInToken(email);
    const digest = new CryptoDelegatedSecretService().digest(token);

    const rows = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.secret_digest, digest));

    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("sign-out ends the session and clears the cookie", async () => {
    const email = `signout-${crypto.randomUUID()}@sogio.dev`;
    await createUserFixture({ name: "Sign Out", email, password });

    const token = await signInToken(email);

    const signOut = await api("/auth/sign-out", {
      method: "POST",
      headers: { Cookie: `${COOKIE}=${token}`, Origin: ALLOWED_ORIGIN },
    });

    expect(signOut.status).toBe(204);
    expect(readSetCookieAttributes(signOut, COOKIE)).toContain("Max-Age=0");

    const afterwards = await api("/auth/me", {
      headers: { Cookie: `${COOKIE}=${token}` },
    });

    expect(afterwards.status).toBe(401);
  });

  it("a revoked session is rejected", async () => {
    const { user } = await createUserFixture({
      name: "Revoked",
      email: `revoked-${crypto.randomUUID()}@sogio.dev`,
      password,
    });
    const token = await createAuthToken(user.id);

    await db
      .update(sessionsTable)
      .set({ revoked_at: new Date() })
      .where(eq(sessionsTable.user_id, user.id));

    const response = await api("/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(401);
  });

  it("an expired session is rejected", async () => {
    const { user } = await createUserFixture({
      name: "Expired",
      email: `expired-${crypto.randomUUID()}@sogio.dev`,
      password,
    });
    const token = await createAuthToken(user.id);

    await db
      .update(sessionsTable)
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where(eq(sessionsTable.user_id, user.id));

    const response = await api("/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(401);
  });

  it("a session left idle past the inactivity window is rejected", async () => {
    const { user } = await createUserFixture({
      name: "Idle",
      email: `idle-${crypto.randomUUID()}@sogio.dev`,
      password,
    });
    const token = await createAuthToken(user.id);

    const longAgo = new Date(
      Date.now() - (env.SESSION_INACTIVITY_TTL_SECONDS + 60) * 1000
    );

    await db
      .update(sessionsTable)
      .set({ last_used_at: longAgo })
      .where(eq(sessionsTable.user_id, user.id));

    const response = await api("/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(401);
  });

  it("a write authenticated by cookie is refused when the Origin is not allowed", async () => {
    const { user } = await createUserFixture({
      name: "Csrf Target",
      email: `csrf-${crypto.randomUUID()}@sogio.dev`,
      password,
    });
    const token = await createAuthToken(user.id);

    const response = await api("/auth/change-password", {
      method: "POST",
      headers: {
        Cookie: `${COOKIE}=${token}`,
        Origin: "https://evil.example",
      },
      body: JSON.stringify({
        currentPassword: password,
        newPassword: "OutraSenha456",
      }),
    });

    expect(response.status).toBe(403);
  });

  it("the same write authenticated by bearer needs no Origin", async () => {
    const email = `bearer-write-${crypto.randomUUID()}@sogio.dev`;
    const { user } = await createUserFixture({
      name: "Bearer Write",
      email,
      password,
    });
    const token = await createAuthToken(user.id);

    const response = await api("/auth/change-password", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        currentPassword: password,
        newPassword: "OutraSenha456",
      }),
    });

    expect(response.status).toBe(204);
  });

  it("a malformed cookie does not break the request", async () => {
    const { user } = await createUserFixture({
      name: "Broken Cookie",
      email: `broken-${crypto.randomUUID()}@sogio.dev`,
      password,
    });
    const token = await createAuthToken(user.id);

    const response = await api("/auth/me", {
      headers: { Cookie: `junk=%; ${COOKIE}=${token}` },
    });

    expect(response.status).toBe(200);
  });

  it("a write by cookie with no Origin at all is refused", async () => {
    const { user } = await createUserFixture({
      name: "No Origin",
      email: `no-origin-${crypto.randomUUID()}@sogio.dev`,
      password,
    });
    const token = await createAuthToken(user.id);

    const response = await api("/auth/change-password", {
      method: "POST",
      headers: { Cookie: `${COOKIE}=${token}` },
      body: JSON.stringify({
        currentPassword: password,
        newPassword: "OutraSenha456",
      }),
    });

    expect(response.status).toBe(403);
  });

  it("signing out does not touch another user's session", async () => {
    const mine = await createUserFixture({
      name: "Mine",
      email: `mine-${crypto.randomUUID()}@sogio.dev`,
      password,
    });
    const theirs = await createUserFixture({
      name: "Theirs",
      email: `theirs-${crypto.randomUUID()}@sogio.dev`,
      password,
    });

    const mySession = await createAuthToken(mine.user.id);
    const theirSession = await createAuthToken(theirs.user.id);

    const first = await api("/auth/sign-out", {
      method: "POST",
      headers: { Cookie: `${COOKIE}=${mySession}`, Origin: ALLOWED_ORIGIN },
    });
    const second = await api("/auth/sign-out", {
      method: "POST",
      headers: { Authorization: `Bearer ${mySession}` },
    });

    expect(first.status).toBe(204);
    expect(second.status).toBe(401);

    const untouched = await api("/auth/me", {
      headers: { Authorization: `Bearer ${theirSession}` },
    });

    expect(untouched.status).toBe(200);
  });

  it("resetting the password by email ends every session, including the caller's", async () => {
    const { user } = await createUserFixture({
      name: "Reset All",
      email: `reset-all-${crypto.randomUUID()}@sogio.dev`,
      password,
    });

    const session = await createAuthToken(user.id);
    const secretService = new CryptoDelegatedSecretService();
    const { secret, digest } = secretService.generate();

    await db.insert(passwordResetRequestsTable).values({
      user_id: user.id,
      token_digest: digest,
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    });

    const reset = await api("/auth/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({ token: secret, newPassword: "OutraSenha456" }),
    });

    expect(reset.status).toBe(204);

    const afterwards = await api("/auth/me", {
      headers: { Authorization: `Bearer ${session}` },
    });

    expect(afterwards.status).toBe(401);
  });

  it("changing the password ends the other sessions and keeps the current one", async () => {
    const email = `rotate-${crypto.randomUUID()}@sogio.dev`;
    const { user } = await createUserFixture({
      name: "Rotate",
      email,
      password,
    });

    const otherSession = await createAuthToken(user.id);
    const currentSession = await createAuthToken(user.id);

    const changed = await api("/auth/change-password", {
      method: "POST",
      headers: {
        Cookie: `${COOKIE}=${currentSession}`,
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        currentPassword: password,
        newPassword: "OutraSenha456",
      }),
    });

    expect(changed.status).toBe(204);

    const withOther = await api("/auth/me", {
      headers: { Authorization: `Bearer ${otherSession}` },
    });
    const withCurrent = await api("/auth/me", {
      headers: { Authorization: `Bearer ${currentSession}` },
    });

    expect(withOther.status).toBe(401);
    expect(withCurrent.status).toBe(200);
  });
});
