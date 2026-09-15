import { describe, it, expect, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { api } from "../../helpers/server";
import { truncate } from "../../helpers/database";
import {
  createUserFixture,
  createAdminFixture,
} from "../../helpers/fixtures/user";
import { createAuthToken } from "../../helpers/fixtures/auth_token";
import {
  createAppRegistrationFixture,
  createAuthorizationRequestFixture,
  createConsentFixture,
} from "../../helpers/fixtures/delegated_access";
import { FREE_PLAN_ID, upgradeToPro } from "../../helpers/fixtures/plan";
import { ConsentPostgresRepository } from "../../../src/auth/infra/database/postgres_repository/delegated_access/consent_postgres_repository";
import { db } from "../../../src/core/infra/database/drizzle/database";
import {
  authorizationCodesTable,
  subscriptionsTable,
} from "../../../src/core/infra/database/drizzle/schema";

const TABLES = [
  "issued_credentials",
  "consents",
  "authorization_codes",
  "authorization_requests",
  "app_registrations",
  "users",
];

const ACCESS_DENIED_DESCRIPTION = "The user denied the authorization request.";
const PLAN_ACCESS_DENIED_DESCRIPTION =
  "This account's plan does not include AI assistant access. Upgrade your plan to connect an AI assistant.";

type DecisionBody = { redirect_to: string };

async function decide(
  token: string,
  identifier: string,
  decision: "approve" | "deny"
): Promise<{ status: number; body: DecisionBody }> {
  const response = await api("/connect/authorize/decision", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ request_id: identifier, decision }),
  });
  return {
    status: response.status,
    body: (await response.json()) as DecisionBody,
  };
}

async function downgradeToFree(userId: string): Promise<void> {
  await db
    .update(subscriptionsTable)
    .set({ plan_id: FREE_PLAN_ID })
    .where(eq(subscriptionsTable.user_id, userId));
}

async function pendingRequest(
  identifier: string,
  token?: string
): Promise<{ can_connect: boolean }> {
  const response = await api(
    `/connect/authorize/pending-request?request_id=${identifier}`,
    {
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }
  );
  return (await response.json()) as { can_connect: boolean };
}

describe("OAuth consent — ai_assistant capability gate", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("free account approving is redirected with error=access_denied, mints no code and creates no consent, and consumes the request", async () => {
    const app = await createAppRegistrationFixture();
    const { user } = await createUserFixture({
      name: "Conta Free",
      email: "free.consent-ai-assistant@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);
    const { identifier } = await createAuthorizationRequestFixture({
      appRegistrationId: app.id,
    });

    const { status, body } = await decide(token, identifier, "approve");

    expect(status).toBe(200);
    const redirectUrl = new URL(body.redirect_to);
    expect(redirectUrl.searchParams.get("error")).toBe("access_denied");
    expect(redirectUrl.searchParams.get("error_description")).toBe(
      PLAN_ACCESS_DENIED_DESCRIPTION
    );
    expect(redirectUrl.searchParams.get("code")).toBeNull();

    const consentRepository = new ConsentPostgresRepository();
    const consent = await consentRepository.findByUserAndApp(user.id, app.id);
    expect(consent).toBeNull();

    const replay = await decide(token, identifier, "approve");
    expect(replay.status).toBe(404);
  });

  it("account that was pro, consented, and fell to free is denied even with a still-usable consent, and the consent is untouched", async () => {
    const app = await createAppRegistrationFixture();
    const { user } = await createUserFixture({
      name: "Conta Rebaixada",
      email: "downgraded.consent-ai-assistant@sogio.dev",
      password: "password123",
    });
    await upgradeToPro(user.id);
    const lastUsedAt = new Date(Date.now() - 60 * 60 * 1000);
    await createConsentFixture({
      userId: user.id,
      appRegistrationId: app.id,
      lastUsedAt,
    });
    await downgradeToFree(user.id);
    const token = await createAuthToken(user.id);
    const { identifier } = await createAuthorizationRequestFixture({
      appRegistrationId: app.id,
    });

    const { status, body } = await decide(token, identifier, "approve");

    expect(status).toBe(200);
    const redirectUrl = new URL(body.redirect_to);
    expect(redirectUrl.searchParams.get("error")).toBe("access_denied");
    expect(redirectUrl.searchParams.get("error_description")).toBe(
      PLAN_ACCESS_DENIED_DESCRIPTION
    );
    expect(redirectUrl.searchParams.get("code")).toBeNull();

    const authorizationCodes = await db.select().from(authorizationCodesTable);
    expect(authorizationCodes).toHaveLength(0);

    const consentRepository = new ConsentPostgresRepository();
    const consent = await consentRepository.findByUserAndApp(user.id, app.id);
    expect(consent).not.toBeNull();
    expect(consent?.last_used_at.getTime()).toBe(lastUsedAt.getTime());
  });

  it("pro account approving mints a code and registers a consent", async () => {
    const app = await createAppRegistrationFixture();
    const { user } = await createUserFixture({
      name: "Conta Pro",
      email: "pro.consent-ai-assistant@sogio.dev",
      password: "password123",
    });
    await upgradeToPro(user.id);
    const token = await createAuthToken(user.id);
    const { identifier } = await createAuthorizationRequestFixture({
      appRegistrationId: app.id,
    });

    const { status, body } = await decide(token, identifier, "approve");

    expect(status).toBe(200);
    const redirectUrl = new URL(body.redirect_to);
    expect(redirectUrl.searchParams.get("error")).toBeNull();
    expect(redirectUrl.searchParams.get("code")).not.toBeNull();

    const consentRepository = new ConsentPostgresRepository();
    const consent = await consentRepository.findByUserAndApp(user.id, app.id);
    expect(consent).not.toBeNull();
  });

  it("admin approving passes even with no subscription at all", async () => {
    const app = await createAppRegistrationFixture();
    const { user } = await createAdminFixture({
      name: "Admin",
      email: "admin.consent-ai-assistant@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);
    const { identifier } = await createAuthorizationRequestFixture({
      appRegistrationId: app.id,
    });

    const { status, body } = await decide(token, identifier, "approve");

    expect(status).toBe(200);
    const redirectUrl = new URL(body.redirect_to);
    expect(redirectUrl.searchParams.get("error")).toBeNull();
    expect(redirectUrl.searchParams.get("code")).not.toBeNull();
  });

  it("free account denying still gets the user's own access_denied, not the plan's", async () => {
    const app = await createAppRegistrationFixture();
    const { user } = await createUserFixture({
      name: "Conta Free",
      email: "free-deny.consent-ai-assistant@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);
    const { identifier } = await createAuthorizationRequestFixture({
      appRegistrationId: app.id,
    });

    const { status, body } = await decide(token, identifier, "deny");

    expect(status).toBe(200);
    const redirectUrl = new URL(body.redirect_to);
    expect(redirectUrl.searchParams.get("error")).toBe("access_denied");
    expect(redirectUrl.searchParams.get("error_description")).toBe(
      ACCESS_DENIED_DESCRIPTION
    );
  });

  it("reports can_connect: false for a free account", async () => {
    const app = await createAppRegistrationFixture();
    const { user } = await createUserFixture({
      name: "Conta Free",
      email: "free-pending.consent-ai-assistant@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);
    const { identifier } = await createAuthorizationRequestFixture({
      appRegistrationId: app.id,
    });

    const result = await pendingRequest(identifier, token);

    expect(result.can_connect).toBe(false);
  });

  it("reports can_connect: true for a pro account", async () => {
    const app = await createAppRegistrationFixture();
    const { user } = await createUserFixture({
      name: "Conta Pro",
      email: "pro-pending.consent-ai-assistant@sogio.dev",
      password: "password123",
    });
    await upgradeToPro(user.id);
    const token = await createAuthToken(user.id);
    const { identifier } = await createAuthorizationRequestFixture({
      appRegistrationId: app.id,
    });

    const result = await pendingRequest(identifier, token);

    expect(result.can_connect).toBe(true);
  });

  it("reports can_connect: true for an admin", async () => {
    const app = await createAppRegistrationFixture();
    const { user } = await createAdminFixture({
      name: "Admin",
      email: "admin-pending.consent-ai-assistant@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);
    const { identifier } = await createAuthorizationRequestFixture({
      appRegistrationId: app.id,
    });

    const result = await pendingRequest(identifier, token);

    expect(result.can_connect).toBe(true);
  });

  it("reports can_connect: false when no caller is identified", async () => {
    const app = await createAppRegistrationFixture();
    const { identifier } = await createAuthorizationRequestFixture({
      appRegistrationId: app.id,
    });

    const result = await pendingRequest(identifier);

    expect(result.can_connect).toBe(false);
  });
});
