import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import {
  createUserFixture,
  createPasswordlessUserFixture,
} from "../helpers/fixtures/user";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import {
  FakeEmailService,
  SilentLogger,
  extractResetTokenFromEmail,
} from "../helpers/fixtures/password_reset";
import { AuthPostgresRepository } from "../../src/auth/infra/database/postgres_repository/auth_postgres_repository";
import { PasswordResetRequestPostgresRepository } from "../../src/auth/infra/database/postgres_repository/password_reset_request_postgres_repository";
import { CryptoDelegatedSecretService } from "../../src/auth/infra/service/crypto_delegated_secret_service";
import { BunHasher } from "../../src/auth/infra/service/bun_hasher";
import { SessionManager } from "../../src/auth/application/service/session_manager";
import { SessionPostgresRepository } from "../../src/auth/infra/database/postgres_repository/session_postgres_repository";
import { RequestPasswordResetUseCase } from "../../src/auth/application/use_case/request_password_reset";
import { ResetPasswordUseCase } from "../../src/auth/application/use_case/reset_password";
import { NO_PASSWORD_MESSAGE } from "../../src/auth/application/use_case/change_password";

const REQUEST_TTL_MS = 60 * 60 * 1000;
const FRONT_BASE_URL = "http://localhost:5173";

function makeRequestUseCase(emailService: FakeEmailService) {
  return new RequestPasswordResetUseCase(
    new AuthPostgresRepository(),
    new PasswordResetRequestPostgresRepository(),
    new CryptoDelegatedSecretService(),
    emailService,
    new SilentLogger(),
    REQUEST_TTL_MS,
    FRONT_BASE_URL
  );
}

function makeResetUseCase() {
  return new ResetPasswordUseCase(
    new AuthPostgresRepository(),
    new PasswordResetRequestPostgresRepository(),
    new CryptoDelegatedSecretService(),
    new BunHasher(),
    new SessionManager(
      new SessionPostgresRepository(),
      new CryptoDelegatedSecretService()
    )
  );
}

describe("Passwordless accounts", () => {
  beforeEach(async () => {
    await truncate([
      "password_reset_requests",
      "sessions",
      "linked_identities",
      "users",
    ]);
  });

  it("401 — login responds with the same body as an unknown email and as a wrong password", async () => {
    const { user } = await createPasswordlessUserFixture({
      name: "No Password",
      email: "no-password@sogio.dev",
    });
    await createUserFixture({
      name: "Has Password",
      email: "has-password@sogio.dev",
      password: "correct-horse-battery",
    });

    const passwordless = await api("/auth/sign-in", {
      method: "POST",
      body: JSON.stringify({ email: user.email, password: "any-password" }),
    });
    const wrongPassword = await api("/auth/sign-in", {
      method: "POST",
      body: JSON.stringify({
        email: "has-password@sogio.dev",
        password: "wrong-password",
      }),
    });
    const unknownEmail = await api("/auth/sign-in", {
      method: "POST",
      body: JSON.stringify({
        email: "ghost@sogio.dev",
        password: "any-password",
      }),
    });

    const passwordlessBody = (await passwordless.json()) as Record<
      string,
      unknown
    >;
    const wrongPasswordBody = (await wrongPassword.json()) as Record<
      string,
      unknown
    >;
    const unknownEmailBody = (await unknownEmail.json()) as Record<
      string,
      unknown
    >;

    expect(passwordless.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(passwordlessBody.message).toBe(wrongPasswordBody.message);
    expect(passwordlessBody.message).toBe(unknownEmailBody.message);
  });

  it("409 — changing the password of a passwordless account leaves it null and ends no session", async () => {
    const { user } = await createPasswordlessUserFixture({
      name: "No Password",
      email: "change-no-password@sogio.dev",
    });
    const token = await createAuthToken(user.id);

    const res = await api("/auth/change-password", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({
        currentPassword: "whatever",
        newPassword: "NovaSenha123",
      }),
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(409);
    expect(body.message).toBe(NO_PASSWORD_MESSAGE);

    const stored = await new AuthPostgresRepository().findUserById(user.id);
    expect(stored?.password).toBeNull();

    const stillAuthenticated = await api("/auth/me", {
      headers: { Authorization: "Bearer " + token },
    });
    expect(stillAuthenticated.status).toBe(200);
  });

  it("recovery followed by reset sets the first password, login works, and has_password turns true", async () => {
    const { user } = await createPasswordlessUserFixture({
      name: "No Password",
      email: "recover-no-password@sogio.dev",
    });

    const before = await api("/auth/me", {
      headers: { Authorization: "Bearer " + (await createAuthToken(user.id)) },
    });
    const beforeBody = (await before.json()) as { has_password: boolean };
    expect(beforeBody.has_password).toBe(false);

    const emailService = new FakeEmailService();
    await makeRequestUseCase(emailService).execute({ email: user.email });
    const resetToken = extractResetTokenFromEmail(
      emailService.sentMessages[0]!
    );

    await makeResetUseCase().execute({
      token: resetToken,
      newPassword: "PrimeiraSenha123",
    });

    const signIn = await api("/auth/sign-in", {
      method: "POST",
      body: JSON.stringify({
        email: user.email,
        password: "PrimeiraSenha123",
      }),
    });
    expect(signIn.status).toBe(200);
    const signInBody = (await signIn.json()) as { token: string };

    const after = await api("/auth/me", {
      headers: { Authorization: "Bearer " + signInBody.token },
    });
    const afterBody = (await after.json()) as { has_password: boolean };
    expect(afterBody.has_password).toBe(true);
  });

  it("GET /auth/me — has_password is false for a passwordless account and true for a regular one", async () => {
    const { user: passwordless } = await createPasswordlessUserFixture({
      name: "No Password",
      email: "me-no-password@sogio.dev",
    });
    const { user: regular } = await createUserFixture({
      name: "Has Password",
      email: "me-has-password@sogio.dev",
      password: "correct-horse-battery",
    });

    const passwordlessRes = await api("/auth/me", {
      headers: {
        Authorization: "Bearer " + (await createAuthToken(passwordless.id)),
      },
    });
    const regularRes = await api("/auth/me", {
      headers: {
        Authorization: "Bearer " + (await createAuthToken(regular.id)),
      },
    });

    const passwordlessBody = (await passwordlessRes.json()) as {
      has_password: boolean;
    };
    const regularBody = (await regularRes.json()) as { has_password: boolean };

    expect(passwordlessBody.has_password).toBe(false);
    expect(regularBody.has_password).toBe(true);
  });

  it("409 — signing up with the email of a passwordless account", async () => {
    const { user } = await createPasswordlessUserFixture({
      name: "No Password",
      email: "signup-conflict@sogio.dev",
    });

    const res = await api("/auth/users", {
      method: "POST",
      body: JSON.stringify({
        name: "Someone Else",
        email: user.email,
        password: "SenhaForte123",
      }),
    });

    expect(res.status).toBe(409);
  });
});
