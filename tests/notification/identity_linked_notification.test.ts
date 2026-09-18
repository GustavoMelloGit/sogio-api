import { describe, it, expect, beforeEach } from "bun:test";
import { and, eq } from "drizzle-orm";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { createLinkedIdentityFixture } from "../helpers/fixtures/linked_identity";
import { FakeExternalIdentityProvider } from "../helpers/fixtures/external_identity_provider";
import { SilentLogger } from "../helpers/fixtures/password_reset";
import {
  CompleteExternalSignInUseCase,
  type CompleteExternalSignInResult,
} from "../../src/auth/application/use_case/complete_external_sign_in";
import { StartExternalSignInUseCase } from "../../src/auth/application/use_case/start_external_sign_in";
import { SessionManager } from "../../src/auth/application/service/session_manager";
import { IdentityLinkedEvent } from "../../src/auth/domain/event/identity_linked_event";
import { AuthPostgresRepository } from "../../src/auth/infra/database/postgres_repository/auth_postgres_repository";
import { ExternalSignInRequestPostgresRepository } from "../../src/auth/infra/database/postgres_repository/external_sign_in_request_postgres_repository";
import { LinkedIdentityPostgresRepository } from "../../src/auth/infra/database/postgres_repository/linked_identity_postgres_repository";
import { SessionPostgresRepository } from "../../src/auth/infra/database/postgres_repository/session_postgres_repository";
import { CryptoDelegatedSecretService } from "../../src/auth/infra/service/crypto_delegated_secret_service";
import { GOOGLE_SIGN_IN_CALLBACK_PATH } from "../../src/auth/presentation/controller/auth/google_sign_in_paths";
import type { EventDispatcher } from "../../src/core/application/event/event_dispatcher";
import type { EventHandler } from "../../src/core/application/event/event_handler";
import type { DomainEvent } from "../../src/core/domain/event/domain_event";
import { apiBaseUrl } from "../../src/core/infra/config/environments";
import { DrizzleTransactionRunner } from "../../src/core/infra/database/drizzle/drizzle_transaction_runner";
import { inMemoryEventDispatcher } from "../../src/core/infra/event/in_memory_event_dispatcher";
import { db } from "../../src/core/infra/database/drizzle/database";
import {
  notificationPreferencesTable,
  notificationsTable,
} from "../../src/core/infra/database/drizzle/schema";
import { NotifyOnIdentityLinked } from "../../src/notification/application/handler/notify_on_identity_linked";
import type {
  NotificationService,
  NotifyInput,
} from "../../src/notification/application/service/notification_service";

const TYPE = "identity_linked";
const PASSWORD = "correct-horse-battery";
const REDIRECT_URI = `${apiBaseUrl}${GOOGLE_SIGN_IN_CALLBACK_PATH}`;

const secretService = new CryptoDelegatedSecretService();
const requestRepository = new ExternalSignInRequestPostgresRepository();
const linkedIdentityRepository = new LinkedIdentityPostgresRepository();
const sessionManager = new SessionManager(
  new SessionPostgresRepository(),
  secretService
);

class IsolatedEventDispatcher implements EventDispatcher {
  readonly #handlers = new Map<string, EventHandler<DomainEvent>[]>();

  register(eventName: string, handler: EventHandler<DomainEvent>): void {
    this.#handlers.set(eventName, [
      ...(this.#handlers.get(eventName) ?? []),
      handler,
    ]);
  }

  async dispatch(event: DomainEvent): Promise<void> {
    await Promise.all(
      (this.#handlers.get(event.name) ?? []).map(handler =>
        handler.handle(event)
      )
    );
  }
}

class FailingNotificationService implements NotificationService {
  attempts: NotifyInput[] = [];

  async notify(input: NotifyInput): Promise<void> {
    this.attempts.push(input);
    throw new Error("notifications table unavailable");
  }
}

function makeCompleteUseCase(
  provider: FakeExternalIdentityProvider,
  eventDispatcher: EventDispatcher = inMemoryEventDispatcher
) {
  return new CompleteExternalSignInUseCase(
    provider,
    requestRepository,
    linkedIdentityRepository,
    new AuthPostgresRepository(),
    sessionManager,
    new DrizzleTransactionRunner(),
    eventDispatcher,
    secretService,
    REDIRECT_URI
  );
}

async function signInWithGoogle(
  provider: FakeExternalIdentityProvider,
  identity: { email: string; subject?: string },
  eventDispatcher?: EventDispatcher
) {
  const started = await new StartExternalSignInUseCase(
    provider,
    requestRepository,
    secretService,
    REDIRECT_URI
  ).execute({});
  const authorization = provider.lastBuildAuthorizationUrlInput;

  if (started.outcome !== "redirect" || !authorization) {
    throw new Error("Expected the external sign-in flow to start");
  }

  provider.respondWithIdentity({ ...identity, nonce: authorization.nonce });

  return makeCompleteUseCase(provider, eventDispatcher).execute({
    query: { state: authorization.state, code: "authorization-code" },
    code_verifier: started.code_verifier,
  });
}

function granted(result: CompleteExternalSignInResult) {
  if (result.outcome === "denied") {
    throw new Error(`Expected the sign-in to succeed, got ${result.error}`);
  }

  return result;
}

async function identityLinkedNotificationsOf(userId: string) {
  return db
    .select()
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.user_id, userId),
        eq(notificationsTable.type, TYPE)
      )
    );
}

async function userWithPassword(prefix: string) {
  const { user } = await createUserFixture({
    name: "Has Password",
    email: `${prefix}-${crypto.randomUUID()}@sogio.dev`,
    password: PASSWORD,
  });

  return user;
}

describe("Identity linked notification", () => {
  let provider: FakeExternalIdentityProvider;

  beforeEach(async () => {
    await truncate([
      "external_sign_in_requests",
      "notifications",
      "notification_preferences",
      "users",
    ]);
    provider = new FakeExternalIdentityProvider();
  });

  it("linking a Google identity to an existing account enqueues a pending identity_linked notification with neither the email nor the sub", async () => {
    const user = await userWithPassword("linked");
    const subject = `google-subject-${crypto.randomUUID()}`;

    const result = await signInWithGoogle(provider, {
      email: user.email,
      subject,
    });

    expect(result.outcome).toBe("linked");

    const rows = await identityLinkedNotificationsOf(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.channel).toBe("email");
    expect(rows[0]?.payload).toEqual({ provider: "google" });

    const serializedPayload = JSON.stringify(rows[0]?.payload);
    expect(serializedPayload).not.toContain(user.email);
    expect(serializedPayload).not.toContain(subject);
  });

  it("creating an account through Google enqueues no identity_linked notification", async () => {
    const result = await signInWithGoogle(provider, {
      email: `brand-new-${crypto.randomUUID()}@sogio.dev`,
    });

    expect(result.outcome).toBe("account_created");
    expect(
      await identityLinkedNotificationsOf(granted(result).user_id)
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(notificationsTable)
        .where(eq(notificationsTable.type, TYPE))
    ).toHaveLength(0);
  });

  it("signing in with an identity that is already linked enqueues nothing", async () => {
    const user = await userWithPassword("already-linked");
    const identity = await createLinkedIdentityFixture({ userId: user.id });

    const result = await signInWithGoogle(provider, {
      email: user.email,
      subject: identity.subject,
    });

    expect(result.outcome).toBe("signed_in");
    expect(await identityLinkedNotificationsOf(user.id)).toHaveLength(0);
  });

  it("the event is dispatched only after the identity is persisted, carrying the user and the provider", async () => {
    const user = await userWithPassword("dispatch-order");
    const dispatcher = new IsolatedEventDispatcher();
    const observed: Array<{ event: IdentityLinkedEvent; persisted: boolean }> =
      [];
    dispatcher.register(IdentityLinkedEvent.NAME, {
      handle: async event => {
        const linked = event as IdentityLinkedEvent;
        observed.push({
          event: linked,
          persisted: await linkedIdentityRepository.existsForUserAndProvider(
            linked.user_id,
            linked.provider
          ),
        });
      },
    });

    const result = await signInWithGoogle(
      provider,
      { email: user.email },
      dispatcher
    );

    expect(result.outcome).toBe("linked");
    expect(observed).toHaveLength(1);
    expect(observed[0]?.persisted).toBe(true);
    expect(observed[0]?.event.user_id).toBe(user.id);
    expect(observed[0]?.event.provider).toBe("google");
  });

  it("a failure to record the notification does not turn the link into a denied sign-in", async () => {
    const user = await userWithPassword("notification-failure");
    const subject = `google-subject-${crypto.randomUUID()}`;
    const failingService = new FailingNotificationService();
    const dispatcher = new IsolatedEventDispatcher();
    dispatcher.register(
      IdentityLinkedEvent.NAME,
      new NotifyOnIdentityLinked(new SilentLogger(), failingService)
    );

    const result = await signInWithGoogle(
      provider,
      { email: user.email, subject },
      dispatcher
    );

    expect(failingService.attempts).toHaveLength(1);
    expect(result).toMatchObject({ outcome: "linked", user_id: user.id });
    expect(
      (await sessionManager.verifySession(granted(result).token)).userId
    ).toBe(user.id);
    expect(
      (
        await linkedIdentityRepository.findByProviderAndSubject(
          "google",
          subject
        )
      )?.user_id
    ).toBe(user.id);
    expect(await identityLinkedNotificationsOf(user.id)).toHaveLength(0);
  });

  it("PUT /notifications/preferences refuses to turn identity_linked off", async () => {
    const user = await userWithPassword("preferences");
    const token = await createAuthToken(user.id);

    const response = await api("/notifications/preferences", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({ type: TYPE, channel: "email", enabled: false }),
    });

    expect(response.status).toBe(422);
    expect(
      await db
        .select()
        .from(notificationPreferencesTable)
        .where(eq(notificationPreferencesTable.user_id, user.id))
    ).toHaveLength(0);
  });
});
