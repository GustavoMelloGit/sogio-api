import { describe, it, expect, beforeEach } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createLinkedIdentityFixture } from "../helpers/fixtures/linked_identity";
import { FakeExternalIdentityProvider } from "../helpers/fixtures/external_identity_provider";
import { FREE_PLAN_ID } from "../helpers/fixtures/plan";
import {
  CompleteExternalSignInUseCase,
  type CompleteExternalSignInInput,
  type CompleteExternalSignInResult,
} from "../../src/auth/application/use_case/complete_external_sign_in";
import { StartExternalSignInUseCase } from "../../src/auth/application/use_case/start_external_sign_in";
import { SessionManager } from "../../src/auth/application/service/session_manager";
import type { LinkedIdentity } from "../../src/auth/domain/entity/linked_identity";
import type { LinkedIdentityRepository } from "../../src/auth/domain/repository/linked_identity_repository";
import { AuthPostgresRepository } from "../../src/auth/infra/database/postgres_repository/auth_postgres_repository";
import { ExternalSignInRequestPostgresRepository } from "../../src/auth/infra/database/postgres_repository/external_sign_in_request_postgres_repository";
import { LinkedIdentityPostgresRepository } from "../../src/auth/infra/database/postgres_repository/linked_identity_postgres_repository";
import { SessionPostgresRepository } from "../../src/auth/infra/database/postgres_repository/session_postgres_repository";
import { CryptoDelegatedSecretService } from "../../src/auth/infra/service/crypto_delegated_secret_service";
import { GOOGLE_SIGN_IN_CALLBACK_PATH } from "../../src/auth/presentation/controller/auth/google_sign_in_paths";
import { apiBaseUrl } from "../../src/core/infra/config/environments";
import { DrizzleTransactionRunner } from "../../src/core/infra/database/drizzle/drizzle_transaction_runner";
import { inMemoryEventDispatcher } from "../../src/core/infra/event/in_memory_event_dispatcher";
import { db } from "../../src/core/infra/database/drizzle/database";
import {
  externalSignInRequestsTable,
  linkedIdentitiesTable,
  sessionsTable,
  subscriptionsTable,
  usersTable,
} from "../../src/core/infra/database/drizzle/schema";

const RETURN_TO = "/connect/authorize?request_id=abc";
const PASSWORD = "correct-horse-battery";
const CODE = "authorization-code";
const REDIRECT_URI = `${apiBaseUrl}${GOOGLE_SIGN_IN_CALLBACK_PATH}`;

const secretService = new CryptoDelegatedSecretService();
const requestRepository = new ExternalSignInRequestPostgresRepository();
const linkedIdentityRepository = new LinkedIdentityPostgresRepository();
const authRepository = new AuthPostgresRepository();
const sessionManager = new SessionManager(
  new SessionPostgresRepository(),
  secretService
);

type PendingFlow = { state: string; nonce: string; codeVerifier: string };

class FailingLinkedIdentityRepository implements LinkedIdentityRepository {
  findByProviderAndSubject(
    ...args: Parameters<LinkedIdentityRepository["findByProviderAndSubject"]>
  ) {
    return linkedIdentityRepository.findByProviderAndSubject(...args);
  }

  existsForUserAndProvider(
    ...args: Parameters<LinkedIdentityRepository["existsForUserAndProvider"]>
  ) {
    return linkedIdentityRepository.existsForUserAndProvider(...args);
  }

  async create(): Promise<LinkedIdentity> {
    throw new Error("linked identity write failed");
  }
}

class StaleLinkedIdentityRepository implements LinkedIdentityRepository {
  async findByProviderAndSubject(): Promise<LinkedIdentity | null> {
    return null;
  }

  existsForUserAndProvider(
    ...args: Parameters<LinkedIdentityRepository["existsForUserAndProvider"]>
  ) {
    return linkedIdentityRepository.existsForUserAndProvider(...args);
  }

  create(identity: LinkedIdentity) {
    return linkedIdentityRepository.create(identity);
  }
}

function makeCompleteUseCase(
  provider: FakeExternalIdentityProvider | null,
  identities: LinkedIdentityRepository = linkedIdentityRepository
) {
  return new CompleteExternalSignInUseCase(
    provider,
    requestRepository,
    identities,
    authRepository,
    sessionManager,
    new DrizzleTransactionRunner(),
    inMemoryEventDispatcher,
    secretService,
    REDIRECT_URI
  );
}

async function startFlow(
  provider: FakeExternalIdentityProvider,
  options: { returnTo?: string } = { returnTo: RETURN_TO }
): Promise<PendingFlow> {
  const started = await new StartExternalSignInUseCase(
    provider,
    requestRepository,
    secretService,
    REDIRECT_URI
  ).execute({ return_to: options.returnTo });
  const authorization = provider.lastBuildAuthorizationUrlInput;

  if (started.outcome !== "redirect" || !authorization) {
    throw new Error("Expected the external sign-in flow to start");
  }

  return {
    state: authorization.state,
    nonce: authorization.nonce,
    codeVerifier: started.code_verifier,
  };
}

function callbackInput(
  flow: PendingFlow,
  query: Record<string, string> = { code: CODE },
  verifier: { codeVerifier?: string } = { codeVerifier: flow.codeVerifier }
): CompleteExternalSignInInput {
  return {
    query: { state: flow.state, ...query },
    code_verifier: verifier.codeVerifier,
  };
}

function granted(result: CompleteExternalSignInResult) {
  if (result.outcome === "denied") {
    throw new Error(`Expected the sign-in to succeed, got ${result.error}`);
  }

  return result;
}

async function sessionOwnerOf(result: CompleteExternalSignInResult) {
  const verified = await sessionManager.verifySession(granted(result).token);

  return verified.userId;
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}@sogio.dev`;
}

async function usersWithEmail(email: string) {
  return db
    .select()
    .from(usersTable)
    .where(sql`lower(${usersTable.email}) = lower(${email})`);
}

async function identitiesOf(userId: string) {
  return db
    .select()
    .from(linkedIdentitiesTable)
    .where(eq(linkedIdentitiesTable.user_id, userId));
}

async function sessionsOf(userId: string) {
  return db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.user_id, userId));
}

async function passwordOf(userId: string) {
  return (await authRepository.findUserById(userId))?.password;
}

describe("CompleteExternalSignInUseCase", () => {
  let provider: FakeExternalIdentityProvider;

  beforeEach(async () => {
    await truncate(["external_sign_in_requests", "users"]);
    provider = new FakeExternalIdentityProvider();
  });

  it("signed_in — a linked sub signs its owner in and ignores the email the provider sends", async () => {
    const { user: owner } = await createUserFixture({
      name: "Owner",
      email: uniqueEmail("owner"),
      password: PASSWORD,
    });
    const identity = await createLinkedIdentityFixture({ userId: owner.id });
    const flow = await startFlow(provider);
    const attestedEmail = uniqueEmail("changed-at-google");
    provider.respondWithIdentity({
      nonce: flow.nonce,
      subject: identity.subject,
      email: attestedEmail,
    });

    const result = await makeCompleteUseCase(provider).execute(
      callbackInput(flow)
    );

    expect(result).toMatchObject({
      outcome: "signed_in",
      user_id: owner.id,
      return_to: RETURN_TO,
    });
    expect(await sessionOwnerOf(result)).toBe(owner.id);
    expect(provider.lastExchangeCodeInput).toEqual({
      code: CODE,
      code_verifier: flow.codeVerifier,
      redirect_uri: REDIRECT_URI,
    });
    expect(await usersWithEmail(attestedEmail)).toHaveLength(0);
    expect((await authRepository.findUserById(owner.id))?.email).toBe(
      owner.email
    );
    expect(await identitiesOf(owner.id)).toHaveLength(1);
  });

  it("signed_in — a sub linked to A with the email of B signs in as A and leaves B untouched", async () => {
    const { user: a } = await createUserFixture({
      name: "Account A",
      email: uniqueEmail("account-a"),
      password: PASSWORD,
    });
    const { user: b } = await createUserFixture({
      name: "Account B",
      email: uniqueEmail("account-b"),
      password: PASSWORD,
    });
    const identity = await createLinkedIdentityFixture({ userId: a.id });
    const flow = await startFlow(provider);
    provider.respondWithIdentity({
      nonce: flow.nonce,
      subject: identity.subject,
      email: b.email,
    });

    const result = await makeCompleteUseCase(provider).execute(
      callbackInput(flow)
    );

    expect(result).toMatchObject({
      outcome: "signed_in",
      user_id: a.id,
      return_to: RETURN_TO,
    });
    expect(await sessionOwnerOf(result)).toBe(a.id);
    expect(await identitiesOf(b.id)).toHaveLength(0);
    expect(await sessionsOf(b.id)).toHaveLength(0);
    expect(await passwordOf(b.id)).toBe(b.password);
  });

  it("signed_in — a linked sub still signs in when the provider does not attest the email", async () => {
    const { user: owner } = await createUserFixture({
      name: "Owner",
      email: uniqueEmail("owner"),
      password: PASSWORD,
    });
    const identity = await createLinkedIdentityFixture({ userId: owner.id });
    const flow = await startFlow(provider);
    provider.respondWithIdentity({
      nonce: flow.nonce,
      subject: identity.subject,
      email: owner.email,
      email_verified: false,
    });

    const result = await makeCompleteUseCase(provider).execute(
      callbackInput(flow)
    );

    expect(result).toMatchObject({
      outcome: "signed_in",
      user_id: owner.id,
      return_to: RETURN_TO,
    });
  });

  it("linked — a verified email of an account with a password links the identity, keeps the hash, and password sign-in keeps working", async () => {
    const { user } = await createUserFixture({
      name: "Has Password",
      email: uniqueEmail("has-password"),
      password: PASSWORD,
    });
    const flow = await startFlow(provider);
    const subject = `google-subject-${crypto.randomUUID()}`;
    provider.respondWithIdentity({
      nonce: flow.nonce,
      subject,
      email: user.email,
    });

    const result = await makeCompleteUseCase(provider).execute(
      callbackInput(flow)
    );

    expect(result).toMatchObject({
      outcome: "linked",
      user_id: user.id,
      return_to: RETURN_TO,
    });
    expect(await sessionOwnerOf(result)).toBe(user.id);

    const linked = await linkedIdentityRepository.findByProviderAndSubject(
      "google",
      subject
    );
    expect(linked?.user_id).toBe(user.id);
    expect(await passwordOf(user.id)).toBe(user.password);

    const signIn = await api("/auth/sign-in", {
      method: "POST",
      body: JSON.stringify({ email: user.email, password: PASSWORD }),
    });
    expect(signIn.status).toBe(200);
  });

  it("account_created — an email with no account creates a passwordless account named after the token, linked and on the Free plan", async () => {
    const flow = await startFlow(provider);
    const email = uniqueEmail("new-at-sogio");
    const subject = `google-subject-${crypto.randomUUID()}`;
    provider.respondWithIdentity({
      nonce: flow.nonce,
      subject,
      email,
      name: "Grace Hopper",
    });

    const result = await makeCompleteUseCase(provider).execute(
      callbackInput(flow)
    );

    expect(result).toMatchObject({
      outcome: "account_created",
      return_to: RETURN_TO,
    });

    const [created] = await usersWithEmail(email);
    expect(created).toBeDefined();
    expect(granted(result).user_id).toBe(created!.id);
    expect(created!.email).toBe(email);
    expect(created!.name).toBe("Grace Hopper");
    expect(created!.password).toBeNull();
    expect(await sessionOwnerOf(result)).toBe(created!.id);

    const linked = await linkedIdentityRepository.findByProviderAndSubject(
      "google",
      subject
    );
    expect(linked?.user_id).toBe(created!.id);

    const subscriptions = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.user_id, created!.id));
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]?.plan_id).toBe(FREE_PLAN_ID);
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["blank", "   "],
  ])(
    "account_created — a %s name falls back to the local part of the email",
    async (_label, name) => {
      const flow = await startFlow(provider);
      const localPart = `local-part-${crypto.randomUUID()}`;
      const email = `${localPart}@sogio.dev`;
      provider.respondWithIdentity({ nonce: flow.nonce, email, name });

      const result = await makeCompleteUseCase(provider).execute(
        callbackInput(flow)
      );

      expect(result.outcome).toBe("account_created");
      const [created] = await usersWithEmail(email);
      expect(created?.name).toBe(localPart);
    }
  );

  it("account_created — the token name is trimmed and truncated to 100 characters", async () => {
    const flow = await startFlow(provider);
    const email = uniqueEmail("long-name");
    provider.respondWithIdentity({
      nonce: flow.nonce,
      email,
      name: `   ${"x".repeat(150)}   `,
    });

    const result = await makeCompleteUseCase(provider).execute(
      callbackInput(flow)
    );

    expect(result.outcome).toBe("account_created");
    const [created] = await usersWithEmail(email);
    expect(created?.name).toBe("x".repeat(100));
  });

  it("email_not_verified — an unverified email matching an account links nothing and signs no one in", async () => {
    const { user } = await createUserFixture({
      name: "Has Password",
      email: uniqueEmail("unverified-match"),
      password: PASSWORD,
    });
    const flow = await startFlow(provider);
    provider.respondWithIdentity({
      nonce: flow.nonce,
      email: user.email,
      email_verified: false,
    });

    const result = await makeCompleteUseCase(provider).execute(
      callbackInput(flow)
    );

    expect(result).toEqual({
      outcome: "denied",
      error: "email_not_verified",
      reason: undefined,
      return_to: RETURN_TO,
    });
    expect(await db.select().from(linkedIdentitiesTable)).toHaveLength(0);
    expect(await sessionsOf(user.id)).toHaveLength(0);
  });

  it("email_not_verified — an unverified email with no account creates nothing", async () => {
    const flow = await startFlow(provider);
    const email = uniqueEmail("unverified-new");
    provider.respondWithIdentity({
      nonce: flow.nonce,
      email,
      email_verified: false,
    });

    const result = await makeCompleteUseCase(provider).execute(
      callbackInput(flow)
    );

    expect(result).toMatchObject({
      outcome: "denied",
      error: "email_not_verified",
      return_to: RETURN_TO,
    });
    expect(await db.select().from(usersTable)).toHaveLength(0);
    expect(await db.select().from(linkedIdentitiesTable)).toHaveLength(0);
    expect(await db.select().from(sessionsTable)).toHaveLength(0);
  });

  it("account_conflict — an account that already has another Google identity refuses the link", async () => {
    const { user } = await createUserFixture({
      name: "Already Linked",
      email: uniqueEmail("already-linked"),
      password: PASSWORD,
    });
    const existing = await createLinkedIdentityFixture({ userId: user.id });
    const flow = await startFlow(provider);
    const otherSubject = `google-subject-${crypto.randomUUID()}`;
    provider.respondWithIdentity({
      nonce: flow.nonce,
      subject: otherSubject,
      email: user.email,
    });

    const result = await makeCompleteUseCase(provider).execute(
      callbackInput(flow)
    );

    expect(result).toMatchObject({
      outcome: "denied",
      error: "account_conflict",
      return_to: RETURN_TO,
    });
    const identities = await identitiesOf(user.id);
    expect(identities.map(identity => identity.subject)).toEqual([
      existing.subject,
    ]);
    expect(
      await linkedIdentityRepository.findByProviderAndSubject(
        "google",
        otherSubject
      )
    ).toBeNull();
    expect(await sessionsOf(user.id)).toHaveLength(0);
  });

  it("account_conflict — two accounts whose emails differ only by case", async () => {
    const localPart = `maria-${crypto.randomUUID()}`;
    await createUserFixture({
      name: "Maria Upper",
      email: `${localPart.toUpperCase()}@Sogio.dev`,
      password: PASSWORD,
    });
    await createUserFixture({
      name: "Maria Lower",
      email: `${localPart}@sogio.dev`,
      password: PASSWORD,
    });
    const flow = await startFlow(provider);
    const attestedEmail = `${localPart}@SOGIO.dev`;
    provider.respondWithIdentity({ nonce: flow.nonce, email: attestedEmail });

    const result = await makeCompleteUseCase(provider).execute(
      callbackInput(flow)
    );

    expect(result).toMatchObject({
      outcome: "denied",
      error: "account_conflict",
      return_to: RETURN_TO,
    });
    expect(await usersWithEmail(attestedEmail)).toHaveLength(2);
    expect(await db.select().from(linkedIdentitiesTable)).toHaveLength(0);
    expect(await db.select().from(sessionsTable)).toHaveLength(0);
  });

  it("linked — a single account whose email differs only by case", async () => {
    const localPart = `maria-${crypto.randomUUID()}`;
    const { user } = await createUserFixture({
      name: "Maria",
      email: `${localPart[0]!.toUpperCase()}${localPart.slice(1)}@Sogio.dev`,
      password: PASSWORD,
    });
    const flow = await startFlow(provider);
    const attestedEmail = `${localPart}@sogio.dev`;
    provider.respondWithIdentity({ nonce: flow.nonce, email: attestedEmail });

    const result = await makeCompleteUseCase(provider).execute(
      callbackInput(flow)
    );

    expect(result).toMatchObject({
      outcome: "linked",
      user_id: user.id,
      return_to: RETURN_TO,
    });
    expect(await usersWithEmail(attestedEmail)).toHaveLength(1);
    expect((await authRepository.findUserById(user.id))?.email).toBe(
      user.email
    );
  });

  it("expired — an unknown state never reaches the provider", async () => {
    const result = await makeCompleteUseCase(provider).execute({
      query: { state: "unknown-state", code: CODE },
      code_verifier: secretService.generate().secret,
    });

    expect(result).toEqual({
      outcome: "denied",
      error: "expired",
      reason: undefined,
      return_to: null,
    });
    expect(provider.lastExchangeCodeInput).toBeNull();
  });

  it("expired — a missing state", async () => {
    const result = await makeCompleteUseCase(provider).execute({
      query: { code: CODE },
      code_verifier: secretService.generate().secret,
    });

    expect(result).toMatchObject({
      outcome: "denied",
      error: "expired",
      return_to: null,
    });
  });

  it("expired — a request past its expiry", async () => {
    const flow = await startFlow(provider);
    provider.respondWithIdentity({ nonce: flow.nonce });
    await db
      .update(externalSignInRequestsTable)
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where(
        eq(
          externalSignInRequestsTable.state_digest,
          secretService.digest(flow.state)
        )
      );

    const result = await makeCompleteUseCase(provider).execute(
      callbackInput(flow)
    );

    expect(result).toMatchObject({
      outcome: "denied",
      error: "expired",
      return_to: null,
    });
    expect(provider.lastExchangeCodeInput).toBeNull();
    expect(await db.select().from(usersTable)).toHaveLength(0);
  });

  it("expired — a state that was already used cannot sign in again", async () => {
    const flow = await startFlow(provider);
    provider.respondWithIdentity({ nonce: flow.nonce });
    const useCase = makeCompleteUseCase(provider);

    const first = await useCase.execute(callbackInput(flow));
    const replay = await useCase.execute(callbackInput(flow));

    expect(first.outcome).toBe("account_created");
    expect(replay).toMatchObject({
      outcome: "denied",
      error: "expired",
      return_to: null,
    });
    expect(await db.select().from(sessionsTable)).toHaveLength(1);
  });

  it("expired — a wrong verifier consumes the request, so the right verifier fails afterwards", async () => {
    const flow = await startFlow(provider);
    provider.respondWithIdentity({ nonce: flow.nonce });
    const useCase = makeCompleteUseCase(provider);

    const wrong = await useCase.execute(
      callbackInput(
        flow,
        { code: CODE },
        { codeVerifier: secretService.generate().secret }
      )
    );

    expect(wrong).toEqual({
      outcome: "denied",
      error: "expired",
      reason: "binding_mismatch",
      return_to: RETURN_TO,
    });
    expect(provider.lastExchangeCodeInput).toBeNull();

    const right = await useCase.execute(callbackInput(flow));

    expect(right).toMatchObject({
      outcome: "denied",
      error: "expired",
      return_to: null,
    });
    expect(provider.lastExchangeCodeInput).toBeNull();
    expect(await db.select().from(usersTable)).toHaveLength(0);
  });

  it("expired — a missing verifier cookie", async () => {
    const flow = await startFlow(provider);
    provider.respondWithIdentity({ nonce: flow.nonce });

    const result = await makeCompleteUseCase(provider).execute(
      callbackInput(flow, { code: CODE }, {})
    );

    expect(result).toEqual({
      outcome: "denied",
      error: "expired",
      reason: "binding_mismatch",
      return_to: RETURN_TO,
    });
    expect(provider.lastExchangeCodeInput).toBeNull();
  });

  it("expired — duplicated query parameters never consume the request", async () => {
    const flow = await startFlow(provider);
    provider.respondWithIdentity({ nonce: flow.nonce });
    const useCase = makeCompleteUseCase(provider);

    const duplicated = await useCase.execute({
      query: null,
      code_verifier: flow.codeVerifier,
    });

    expect(duplicated).toMatchObject({
      outcome: "denied",
      error: "expired",
      return_to: null,
    });

    const afterwards = await useCase.execute(callbackInput(flow));

    expect(afterwards).toMatchObject({
      outcome: "account_created",
      return_to: RETURN_TO,
    });
  });

  it("canceled — the provider reports access_denied", async () => {
    const flow = await startFlow(provider);

    const result = await makeCompleteUseCase(provider).execute(
      callbackInput(flow, { error: "access_denied" })
    );

    expect(result).toEqual({
      outcome: "denied",
      error: "canceled",
      reason: undefined,
      return_to: RETURN_TO,
    });
    expect(provider.lastExchangeCodeInput).toBeNull();
  });

  it("unavailable — any other provider error", async () => {
    const flow = await startFlow(provider);

    const result = await makeCompleteUseCase(provider).execute(
      callbackInput(flow, { error: "server_error" })
    );

    expect(result).toEqual({
      outcome: "denied",
      error: "unavailable",
      reason: "provider_error",
      return_to: RETURN_TO,
    });
    expect(provider.lastExchangeCodeInput).toBeNull();
  });

  it("unavailable — the callback carries no code", async () => {
    const flow = await startFlow(provider);

    const result = await makeCompleteUseCase(provider).execute(
      callbackInput(flow, {})
    );

    expect(result).toMatchObject({
      outcome: "denied",
      error: "unavailable",
      return_to: RETURN_TO,
    });
    expect(provider.lastExchangeCodeInput).toBeNull();
  });

  it.each(["token_exchange_failed", "claims_invalid"] as const)(
    "unavailable — the code exchange fails with %s",
    async reason => {
      const flow = await startFlow(provider);
      provider.respondWithFailure(reason);

      const result = await makeCompleteUseCase(provider).execute(
        callbackInput(flow)
      );

      expect(result).toEqual({
        outcome: "denied",
        error: "unavailable",
        reason,
        return_to: RETURN_TO,
      });
      expect(await db.select().from(usersTable)).toHaveLength(0);
    }
  );

  it.each([
    ["a different nonce", "a-nonce-this-request-never-issued"],
    ["no nonce", null],
  ])("unavailable — the token carries %s", async (_label, nonce) => {
    const flow = await startFlow(provider);
    provider.respondWithIdentity({ nonce });

    const result = await makeCompleteUseCase(provider).execute(
      callbackInput(flow)
    );

    expect(result).toEqual({
      outcome: "denied",
      error: "unavailable",
      reason: "nonce_mismatch",
      return_to: RETURN_TO,
    });
    expect(await db.select().from(usersTable)).toHaveLength(0);
  });

  it("unavailable — an unconfigured provider answers before the request is claimed", async () => {
    const flow = await startFlow(provider);
    provider.respondWithIdentity({ nonce: flow.nonce });

    const unconfigured = await makeCompleteUseCase(null).execute(
      callbackInput(flow)
    );

    expect(unconfigured).toMatchObject({
      outcome: "denied",
      error: "unavailable",
      return_to: null,
    });

    const configured = await makeCompleteUseCase(provider).execute(
      callbackInput(flow)
    );

    expect(configured.outcome).toBe("account_created");
  });

  it("atomicity — when writing the identity fails during account creation, no account is left behind", async () => {
    const flow = await startFlow(provider);
    const email = uniqueEmail("atomic");
    provider.respondWithIdentity({ nonce: flow.nonce, email });

    const result = await makeCompleteUseCase(
      provider,
      new FailingLinkedIdentityRepository()
    ).execute(callbackInput(flow));

    expect(result).toMatchObject({
      outcome: "denied",
      error: "unavailable",
      reason: "unexpected_error",
      return_to: RETURN_TO,
    });
    expect(await usersWithEmail(email)).toHaveLength(0);
    expect(await db.select().from(usersTable)).toHaveLength(0);
    expect(await db.select().from(linkedIdentitiesTable)).toHaveLength(0);
    expect(await db.select().from(sessionsTable)).toHaveLength(0);
    expect(await db.select().from(subscriptionsTable)).toHaveLength(0);
  });

  it("atomicity — a uniqueness violation from a concurrent link rolls the new account back and answers unavailable", async () => {
    const { user: other } = await createUserFixture({
      name: "Other Tab",
      email: uniqueEmail("other-tab"),
      password: PASSWORD,
    });
    const identity = await createLinkedIdentityFixture({ userId: other.id });
    const flow = await startFlow(provider);
    const email = uniqueEmail("race");
    provider.respondWithIdentity({
      nonce: flow.nonce,
      subject: identity.subject,
      email,
    });

    const result = await makeCompleteUseCase(
      provider,
      new StaleLinkedIdentityRepository()
    ).execute(callbackInput(flow));

    expect(result).toMatchObject({
      outcome: "denied",
      error: "unavailable",
      reason: "unexpected_error",
      return_to: RETURN_TO,
    });
    expect(await usersWithEmail(email)).toHaveLength(0);
    expect(await identitiesOf(other.id)).toHaveLength(1);
    expect(await sessionsOf(other.id)).toHaveLength(0);
  });

  it("a flow started without a destination returns a null return_to", async () => {
    const flow = await startFlow(provider, {});
    provider.respondWithIdentity({ nonce: flow.nonce });

    const result = await makeCompleteUseCase(provider).execute(
      callbackInput(flow)
    );

    expect(result).toMatchObject({
      outcome: "account_created",
      return_to: null,
    });
  });
});
