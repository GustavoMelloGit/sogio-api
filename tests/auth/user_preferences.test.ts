import { describe, it, expect, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { db } from "../../src/core/infra/database/drizzle/database";
import { usersTable } from "../../src/core/infra/database/drizzle/schema";
import {
  FakeEmailService,
  SilentLogger,
} from "../helpers/fixtures/password_reset";
import { AuthPostgresRepository } from "../../src/auth/infra/database/postgres_repository/auth_postgres_repository";
import { PasswordResetRequestPostgresRepository } from "../../src/auth/infra/database/postgres_repository/password_reset_request_postgres_repository";
import { CryptoDelegatedSecretService } from "../../src/auth/infra/service/crypto_delegated_secret_service";
import { RequestPasswordResetUseCase } from "../../src/auth/application/use_case/request_password_reset";

function makeRequestPasswordResetUseCase(emailService: FakeEmailService) {
  return new RequestPasswordResetUseCase(
    new AuthPostgresRepository(),
    new PasswordResetRequestPostgresRepository(),
    new CryptoDelegatedSecretService(),
    emailService,
    new SilentLogger(),
    60 * 60 * 1000,
    "http://localhost:5173"
  );
}

const TABLES = ["users"];

type PreferencesBody = {
  locale: string;
  time_zone: string;
  supported_locales?: string[];
};

async function authenticatedUser() {
  const { user } = await createUserFixture({
    name: "João Silva",
    email: "joao@sogio.dev",
    password: "password123",
  });

  return { user, token: await createAuthToken(user.id) };
}

function authorized(token: string, init?: RequestInit): RequestInit {
  return {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
      ...(init?.headers ?? {}),
    },
  };
}

describe("User display preferences", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("GET /auth/me/preferences returns the defaults for a new account", async () => {
    const { token } = await authenticatedUser();

    const res = await api("/auth/me/preferences", authorized(token));

    expect(res.status).toBe(200);
    const body = (await res.json()) as PreferencesBody;
    expect(body.locale).toBe("pt-BR");
    expect(body.time_zone).toBe("America/Sao_Paulo");
    expect(body.supported_locales).toEqual(["pt-BR", "en-US"]);
  });

  it("PATCH /auth/me/preferences persists the chosen language and time zone", async () => {
    const { user, token } = await authenticatedUser();

    const res = await api(
      "/auth/me/preferences",
      authorized(token, {
        method: "PATCH",
        body: JSON.stringify({
          locale: "en-US",
          time_zone: "Europe/Lisbon",
        }),
      })
    );

    expect(res.status).toBe(200);

    const row = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, user.id),
    });

    expect(row?.locale).toBe("en-US");
    expect(row?.time_zone).toBe("Europe/Lisbon");
  });

  it("PATCH /auth/me/preferences keeps the field that was not sent", async () => {
    const { user, token } = await authenticatedUser();

    await api(
      "/auth/me/preferences",
      authorized(token, {
        method: "PATCH",
        body: JSON.stringify({ locale: "en-US" }),
      })
    );

    const row = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, user.id),
    });

    expect(row?.locale).toBe("en-US");
    expect(row?.time_zone).toBe("America/Sao_Paulo");
  });

  it("rejects an unsupported language", async () => {
    const { token } = await authenticatedUser();

    const res = await api(
      "/auth/me/preferences",
      authorized(token, {
        method: "PATCH",
        body: JSON.stringify({ locale: "fr-FR" }),
      })
    );

    expect(res.status).toBe(422);
  });

  it("rejects an unknown time zone", async () => {
    const { token } = await authenticatedUser();

    const res = await api(
      "/auth/me/preferences",
      authorized(token, {
        method: "PATCH",
        body: JSON.stringify({ time_zone: "Mars/Olympus_Mons" }),
      })
    );

    expect(res.status).toBe(422);
  });

  it("rejects an empty update", async () => {
    const { token } = await authenticatedUser();

    const res = await api(
      "/auth/me/preferences",
      authorized(token, { method: "PATCH", body: JSON.stringify({}) })
    );

    expect(res.status).toBe(422);
  });

  it("GET /auth/me exposes the preferences alongside the profile", async () => {
    const { token } = await authenticatedUser();

    const res = await api("/auth/me", authorized(token));
    const body = (await res.json()) as PreferencesBody;

    expect(body.locale).toBe("pt-BR");
    expect(body.time_zone).toBe("America/Sao_Paulo");
  });

  it("requires authentication", async () => {
    const res = await api("/auth/me/preferences");

    expect(res.status).toBe(401);
  });
});

describe("Content addressed to the user follows their language", () => {
  beforeEach(async () => {
    await truncate(["password_reset_requests", "users"]);
  });

  it("sends the password reset email in the language the user chose", async () => {
    const { user } = await createUserFixture({
      name: "Ada Lovelace",
      email: "ada@sogio.dev",
      password: "correct-horse-battery",
    });
    await db
      .update(usersTable)
      .set({ locale: "en-US" })
      .where(eq(usersTable.id, user.id));

    const emailService = new FakeEmailService();
    await makeRequestPasswordResetUseCase(emailService).execute({
      email: "ada@sogio.dev",
    });

    const message = emailService.sentMessages[0];
    expect(message?.subject).toBe("Password reset - Sogio");
    expect(message?.html).toContain('<html lang="en-US">');
    expect(message?.html).toContain("Forgot your password?");
    expect(message?.text).toContain("Hi Ada Lovelace,");
  });

  it("keeps sending it in Portuguese for an account that never configured one", async () => {
    await createUserFixture({
      name: "Ada Lovelace",
      email: "ada@sogio.dev",
      password: "correct-horse-battery",
    });

    const emailService = new FakeEmailService();
    await makeRequestPasswordResetUseCase(emailService).execute({
      email: "ada@sogio.dev",
    });

    const message = emailService.sentMessages[0];
    expect(message?.subject).toBe("Redefinição de senha - Sogio");
    expect(message?.html).toContain('<html lang="pt-BR">');
  });
});
