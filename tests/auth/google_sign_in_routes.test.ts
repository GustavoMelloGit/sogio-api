import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { api, readSetCookie, readSetCookieAttributes } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createLinkedIdentityFixture } from "../helpers/fixtures/linked_identity";
import { FakeExternalIdentityProvider } from "../helpers/fixtures/external_identity_provider";
import { SilentLogger } from "../helpers/fixtures/password_reset";
import { makeTestEntitlementService } from "../helpers/entitlement_service";
import { CompleteExternalSignInUseCase } from "../../src/auth/application/use_case/complete_external_sign_in";
import { StartExternalSignInUseCase } from "../../src/auth/application/use_case/start_external_sign_in";
import { SessionManager } from "../../src/auth/application/service/session_manager";
import { computeS256Challenge } from "../../src/auth/domain/service/pkce_policy";
import { AuthPostgresRepository } from "../../src/auth/infra/database/postgres_repository/auth_postgres_repository";
import { ExternalSignInRequestPostgresRepository } from "../../src/auth/infra/database/postgres_repository/external_sign_in_request_postgres_repository";
import { LinkedIdentityPostgresRepository } from "../../src/auth/infra/database/postgres_repository/linked_identity_postgres_repository";
import { SessionPostgresRepository } from "../../src/auth/infra/database/postgres_repository/session_postgres_repository";
import { CryptoDelegatedSecretService } from "../../src/auth/infra/service/crypto_delegated_secret_service";
import { CompleteGoogleSignInController } from "../../src/auth/presentation/controller/auth/complete_google_sign_in.controller";
import { StartGoogleSignInController } from "../../src/auth/presentation/controller/auth/start_google_sign_in.controller";
import {
  GOOGLE_SIGN_IN_CALLBACK_PATH,
  GOOGLE_SIGN_IN_RESULT_PATH,
  GOOGLE_SIGN_IN_START_PATH,
} from "../../src/auth/presentation/controller/auth/google_sign_in_paths";
import { externalSignInCookieName } from "../../src/auth/presentation/http/external_sign_in_cookie";
import { sessionCookieName } from "../../src/auth/presentation/http/session_cookie";
import {
  apiBaseUrl,
  env,
  frontBaseUrl,
} from "../../src/core/infra/config/environments";
import { BunHttpControllerAdapter } from "../../src/core/infra/http/adapters/http_controller_adapter";
import { DrizzleTransactionRunner } from "../../src/core/infra/database/drizzle/drizzle_transaction_runner";
import { inMemoryEventDispatcher } from "../../src/core/infra/event/in_memory_event_dispatcher";
import { db } from "../../src/core/infra/database/drizzle/database";
import { externalSignInRequestsTable } from "../../src/core/infra/database/drizzle/schema";
import { HttpControllerMethod } from "../../src/core/presentation/controller/controller";

const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
const REDIRECT_URI = `${apiBaseUrl}${GOOGLE_SIGN_IN_CALLBACK_PATH}`;
const RESULT_URL = `${frontBaseUrl}${GOOGLE_SIGN_IN_RESULT_PATH}`;
const VERIFIER_COOKIE = externalSignInCookieName();
const SESSION_COOKIE = sessionCookieName();
const CONSENT_RETURN_TO = "/connect/authorize?request_id=abc";
const PASSWORD = "correct-horse-battery";

const secretService = new CryptoDelegatedSecretService();
const requestRepository = new ExternalSignInRequestPostgresRepository();
const provider = new FakeExternalIdentityProvider();

const completeWithDouble = new CompleteGoogleSignInController(
  new CompleteExternalSignInUseCase(
    provider,
    requestRepository,
    new LinkedIdentityPostgresRepository(),
    new AuthPostgresRepository(),
    new SessionManager(new SessionPostgresRepository(), secretService),
    new DrizzleTransactionRunner(),
    inMemoryEventDispatcher,
    secretService,
    REDIRECT_URI
  ),
  new SilentLogger()
);

const startWithoutProvider = new StartGoogleSignInController(
  new StartExternalSignInUseCase(
    null,
    requestRepository,
    secretService,
    REDIRECT_URI
  ),
  new SilentLogger()
);

const doubleServer = Bun.serve({
  port: 0,
  routes: {
    [completeWithDouble.path]: {
      [HttpControllerMethod.GET]: BunHttpControllerAdapter(
        completeWithDouble,
        false,
        makeTestEntitlementService()
      ),
    },
    [startWithoutProvider.path]: {
      [HttpControllerMethod.GET]: BunHttpControllerAdapter(
        startWithoutProvider,
        false,
        makeTestEntitlementService()
      ),
    },
  },
});

const doubleBaseUrl = `http://localhost:${doubleServer.port}`;

afterAll(() => {
  doubleServer.stop();
});

type StartedSignIn = {
  response: Response;
  location: URL;
  state: string;
  nonce: string;
  verifier: string;
};

async function startSignIn(query = ""): Promise<StartedSignIn> {
  const response = await api(`${GOOGLE_SIGN_IN_START_PATH}${query}`, {
    redirect: "manual",
  });
  const location = new URL(response.headers.get("location") ?? "");

  return {
    response,
    location,
    state: location.searchParams.get("state") ?? "",
    nonce: location.searchParams.get("nonce") ?? "",
    verifier: readSetCookie(response, VERIFIER_COOKIE) ?? "",
  };
}

function returnToQuery(returnTo: string): string {
  return `?return_to=${encodeURIComponent(returnTo)}`;
}

function verifierCookie(verifier: string): Record<string, string> {
  return { Cookie: `${VERIFIER_COOKIE}=${verifier}` };
}

function callbackThroughRealRoutes(
  query: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  return api(`${GOOGLE_SIGN_IN_CALLBACK_PATH}${query}`, {
    redirect: "manual",
    headers,
  });
}

function callbackThroughDouble(
  query: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(`${doubleBaseUrl}${GOOGLE_SIGN_IN_CALLBACK_PATH}${query}`, {
    redirect: "manual",
    headers,
  });
}

function stateQuery(state: string, extra: Record<string, string> = {}) {
  return `?${new URLSearchParams({ state, ...extra }).toString()}`;
}

async function requestRowOf(state: string) {
  const rows = await db
    .select()
    .from(externalSignInRequestsTable)
    .where(
      eq(externalSignInRequestsTable.state_digest, secretService.digest(state))
    );

  return rows[0];
}

async function expectFrontResultRedirect(
  response: Response,
  expectedParams: Record<string, string>
): Promise<void> {
  expect(response.status).toBe(302);

  const location = response.headers.get("location") ?? "";
  expect(location.startsWith(`${RESULT_URL}?`)).toBe(true);
  expect(Object.fromEntries(new URL(location).searchParams)).toEqual(
    expectedParams
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("content-type") ?? "").not.toContain("json");
  expect(await response.text()).toBe("");
}

function expectNoSessionCookie(response: Response): void {
  expect(readSetCookie(response, SESSION_COOKIE)).toBeUndefined();
}

function expectVerifierCookieCleared(response: Response): void {
  const attributes = readSetCookieAttributes(response, VERIFIER_COOKIE) ?? "";

  expect(attributes.startsWith(`${VERIFIER_COOKIE}=;`)).toBe(true);
  expect(attributes).toContain("Max-Age=0");
}

describe("Google sign-in routes", () => {
  beforeEach(async () => {
    await truncate(["external_sign_in_requests", "users"]);
  });

  describe(`GET ${GOOGLE_SIGN_IN_START_PATH}`, () => {
    it("302 to Google's authorization endpoint with every parameter the flow needs, and a verifier cookie bound to the challenge", async () => {
      const { response, location, state, nonce, verifier } =
        await startSignIn();

      expect(response.status).toBe(302);
      expect(`${location.origin}${location.pathname}`).toBe(
        GOOGLE_AUTHORIZATION_ENDPOINT
      );
      expect(location.searchParams.get("client_id")).toBe(
        env.GOOGLE_CLIENT_ID!
      );
      expect(location.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
      expect(location.searchParams.get("response_type")).toBe("code");
      expect(location.searchParams.get("scope")).toBe("openid email profile");
      expect(location.searchParams.get("code_challenge_method")).toBe("S256");
      expect(location.searchParams.get("prompt")).toBe("select_account");
      expect(location.searchParams.has("access_type")).toBe(false);
      expect(state.length).toBeGreaterThan(0);
      expect(nonce.length).toBeGreaterThan(0);
      expect(verifier.length).toBeGreaterThan(0);
      expect(location.searchParams.get("code_challenge")).toBe(
        computeS256Challenge(verifier)
      );

      const attributes =
        readSetCookieAttributes(response, VERIFIER_COOKIE) ?? "";
      expect(attributes).toContain("HttpOnly");
      expect(attributes).toContain("SameSite=Lax");
      expect(attributes).toContain("Path=/");
      expect(attributes).not.toContain("Domain=");
      const maxAge = Number(attributes.match(/Max-Age=(\d+)/)?.[1]);
      expect(maxAge).toBeGreaterThan(0);
      expect(maxAge).toBeLessThanOrEqual(600);

      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expectNoSessionCookie(response);

      const row = await requestRowOf(state);
      expect(row).toBeDefined();
      expect(row?.code_challenge).toBe(computeS256Challenge(verifier));
      expect(row?.nonce_digest).toBe(secretService.digest(nonce));
      expect(row?.consumed_at).toBeNull();
      expect(row?.return_to).toBeNull();

      const stored = JSON.stringify(
        await db.select().from(externalSignInRequestsTable)
      );
      expect(stored).not.toContain(state);
      expect(stored).not.toContain(nonce);
      expect(stored).not.toContain(verifier);
    });

    it("records a valid return_to on the request", async () => {
      const { state } = await startSignIn(returnToQuery(CONSENT_RETURN_TO));

      expect((await requestRowOf(state))?.return_to).toBe(CONSENT_RETURN_TO);
    });

    it.each(["//evil.com", "https://evil.com", "/\\evil.com"])(
      "discards the return_to %p and still sends the browser to Google",
      async returnTo => {
        const { response, location, state } = await startSignIn(
          returnToQuery(returnTo)
        );

        expect(response.status).toBe(302);
        expect(`${location.origin}${location.pathname}`).toBe(
          GOOGLE_AUTHORIZATION_ENDPOINT
        );
        expect((await requestRowOf(state))?.return_to).toBeNull();
      }
    );

    it.todo(
      "discards a duplicated return_to and still sends the browser to Google",
      async () => {
        const { response, location, state } = await startSignIn(
          "?return_to=%2Fapp&return_to=%2Fsettings"
        );

        expect(response.status).toBe(302);
        expect(`${location.origin}${location.pathname}`).toBe(
          GOOGLE_AUTHORIZATION_ENDPOINT
        );
        expect((await requestRowOf(state))?.return_to).toBeNull();
      }
    );

    it("an unconfigured provider sends the browser to the front with error=unavailable, without a verifier cookie", async () => {
      const response = await fetch(
        `${doubleBaseUrl}${GOOGLE_SIGN_IN_START_PATH}${returnToQuery("/app")}`,
        { redirect: "manual" }
      );

      await expectFrontResultRedirect(response, { error: "unavailable" });
      expect(readSetCookie(response, VERIFIER_COOKIE)).toBeUndefined();
      expectNoSessionCookie(response);
      expect(await db.select().from(externalSignInRequestsTable)).toHaveLength(
        0
      );
    });
  });

  describe(`GET ${GOOGLE_SIGN_IN_CALLBACK_PATH} through the real routes`, () => {
    it("expired — no state", async () => {
      const { verifier } = await startSignIn();

      const response = await callbackThroughRealRoutes(
        "?code=authorization-code",
        verifierCookie(verifier)
      );

      await expectFrontResultRedirect(response, { error: "expired" });
      expectNoSessionCookie(response);
    });

    it("expired — an unknown state", async () => {
      const { verifier } = await startSignIn();

      const response = await callbackThroughRealRoutes(
        stateQuery("a-state-nobody-issued", { code: "authorization-code" }),
        verifierCookie(verifier)
      );

      await expectFrontResultRedirect(response, { error: "expired" });
      expectNoSessionCookie(response);
    });

    it("expired — a verifier cookie from another browser returns return_to and clears the cookie", async () => {
      const { state } = await startSignIn(returnToQuery(CONSENT_RETURN_TO));
      const { verifier: otherBrowserVerifier } = await startSignIn();

      const response = await callbackThroughRealRoutes(
        stateQuery(state, { code: "authorization-code" }),
        verifierCookie(otherBrowserVerifier)
      );

      await expectFrontResultRedirect(response, {
        error: "expired",
        return_to: CONSENT_RETURN_TO,
      });
      expectNoSessionCookie(response);
      expectVerifierCookieCleared(response);
      expect((await requestRowOf(state))?.consumed_at).toBeInstanceOf(Date);
    });

    it("expired — a duplicated state never consumes the request", async () => {
      const { state, verifier } = await startSignIn(
        returnToQuery(CONSENT_RETURN_TO)
      );
      const encodedState = encodeURIComponent(state);

      const duplicated = await callbackThroughRealRoutes(
        `?state=${encodedState}&state=${encodedState}&error=access_denied`,
        verifierCookie(verifier)
      );

      await expectFrontResultRedirect(duplicated, { error: "expired" });
      expectNoSessionCookie(duplicated);
      expect((await requestRowOf(state))?.consumed_at).toBeNull();
    });

    it("canceled — access_denied with the right cookie returns return_to and clears the verifier cookie", async () => {
      const { state, verifier } = await startSignIn(
        returnToQuery(CONSENT_RETURN_TO)
      );

      const response = await callbackThroughRealRoutes(
        stateQuery(state, { error: "access_denied" }),
        verifierCookie(verifier)
      );

      await expectFrontResultRedirect(response, {
        error: "canceled",
        return_to: CONSENT_RETURN_TO,
      });
      expectNoSessionCookie(response);
      expectVerifierCookieCleared(response);
    });
  });

  describe(`GET ${GOOGLE_SIGN_IN_CALLBACK_PATH} with the provider double`, () => {
    it.each([
      [
        "signed_in",
        async () => {
          const { user } = await createUserFixture({
            name: "Linked Owner",
            email: `linked-owner-${crypto.randomUUID()}@sogio.dev`,
            password: PASSWORD,
          });
          const identity = await createLinkedIdentityFixture({
            userId: user.id,
          });
          return { email: user.email, subject: identity.subject };
        },
      ],
      [
        "linked",
        async () => {
          const { user } = await createUserFixture({
            name: "Has Password",
            email: `has-password-${crypto.randomUUID()}@sogio.dev`,
            password: PASSWORD,
          });
          return {
            email: user.email,
            subject: `google-subject-${crypto.randomUUID()}`,
          };
        },
      ],
      [
        "account_created",
        async () => ({
          email: `brand-new-${crypto.randomUUID()}@sogio.dev`,
          subject: `google-subject-${crypto.randomUUID()}`,
        }),
      ],
    ] as const)(
      "%s — 302 to the front with the status and a session cookie that authenticates GET /auth/me",
      async (status, arrange) => {
        const { email, subject } = await arrange();
        const { state, nonce, verifier } = await startSignIn(
          returnToQuery(CONSENT_RETURN_TO)
        );
        provider.respondWithIdentity({ nonce, subject, email });

        const response = await callbackThroughDouble(
          stateQuery(state, { code: "authorization-code" }),
          verifierCookie(verifier)
        );

        await expectFrontResultRedirect(response, {
          status,
          return_to: CONSENT_RETURN_TO,
        });
        expect(readSetCookie(response, VERIFIER_COOKIE)).toBeUndefined();

        const sessionAttributes =
          readSetCookieAttributes(response, SESSION_COOKIE) ?? "";
        expect(sessionAttributes).toContain("HttpOnly");
        expect(sessionAttributes).toContain("SameSite=Lax");
        expect(sessionAttributes).toContain("Path=/");

        const session = readSetCookie(response, SESSION_COOKIE) ?? "";
        expect(session.length).toBeGreaterThan(0);
        expect(response.headers.get("location") ?? "").not.toContain(session);

        const me = await api("/auth/me", {
          headers: { Cookie: `${SESSION_COOKIE}=${session}` },
        });
        const body = (await me.json()) as { email: string };

        expect(me.status).toBe(200);
        expect(body.email).toBe(email);
      }
    );
  });

  it("no Location ever points straight at the return_to", async () => {
    const locations: string[] = [];

    const denied = await startSignIn(returnToQuery(CONSENT_RETURN_TO));
    locations.push(denied.location.toString());
    const deniedCallback = await callbackThroughRealRoutes(
      stateQuery(denied.state, { error: "access_denied" }),
      verifierCookie(denied.verifier)
    );
    locations.push(deniedCallback.headers.get("location") ?? "");

    const granted = await startSignIn(returnToQuery(CONSENT_RETURN_TO));
    locations.push(granted.location.toString());
    provider.respondWithIdentity({ nonce: granted.nonce });
    const grantedCallback = await callbackThroughDouble(
      stateQuery(granted.state, { code: "authorization-code" }),
      verifierCookie(granted.verifier)
    );
    locations.push(grantedCallback.headers.get("location") ?? "");

    const hostile = await startSignIn(
      returnToQuery("https://evil.example/steal")
    );
    locations.push(hostile.location.toString());

    const allowedOrigins = [
      new URL(GOOGLE_AUTHORIZATION_ENDPOINT).origin,
      new URL(frontBaseUrl).origin,
    ];

    expect(locations).toHaveLength(5);
    for (const location of locations) {
      const url = new URL(location);

      expect(allowedOrigins).toContain(url.origin);
      expect(url.pathname).not.toBe("/connect/authorize");
      expect(location.startsWith(`${frontBaseUrl}${CONSENT_RETURN_TO}`)).toBe(
        false
      );
    }
  });
});
