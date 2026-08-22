import { describe, it, expect, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { db } from "../../src/core/infra/database/drizzle/database";
import {
  notificationsTable,
  notificationPreferencesTable,
} from "../../src/core/infra/database/drizzle/schema";
import { ConsoleLogger } from "../../src/core/infra/logger/console_logger";
import { NotificationPostgresRepository } from "../../src/notification/infra/database/postgres_repository/notification_postgres_repository";
import { NotificationPreferencePostgresRepository } from "../../src/notification/infra/database/postgres_repository/notification_preference_postgres_repository";
import { PersistingNotificationService } from "../../src/notification/application/service/persisting_notification_service";
import { NotifyOnSubscriptionPaymentFailed } from "../../src/notification/application/handler/notify_on_subscription_payment_failed";
import { SubscriptionPaymentFailedEvent } from "../../src/billing/domain/event/subscription_payment_failed_event";
import { SubscriptionTrialEndingEvent } from "../../src/billing/domain/event/subscription_trial_ending_event";
import { NotifyOnSubscriptionTrialEnding } from "../../src/notification/application/handler/notify_on_subscription_trial_ending";
import { NotificationDi } from "../../src/notification/infra/di/notification_di";

const TABLES = ["notifications", "notification_preferences", "users"];
const TYPE = "subscription_payment_failed";

type PreferencesBody = {
  preferences: Array<{
    type: string;
    label: string;
    optional: boolean;
    channels: Array<{ channel: string; enabled: boolean }>;
  }>;
};

function makeService() {
  return new PersistingNotificationService(
    new ConsoleLogger(),
    new NotificationPostgresRepository(),
    new NotificationPreferencePostgresRepository()
  );
}

async function authenticatedUser() {
  const { user } = await createUserFixture({
    name: "João Silva",
    email: "joao@sogio.dev",
    password: "password123",
  });

  return { user, token: await createAuthToken(user.id) };
}

describe("Notification preferences", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("GET /notifications/preferences lists every type with its default", async () => {
    const { token } = await authenticatedUser();

    const res = await api("/notifications/preferences", {
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as PreferencesBody;
    const entry = body.preferences.find(item => item.type === TYPE);

    expect(entry).toBeDefined();
    expect(entry?.channels).toEqual([{ channel: "email", enabled: true }]);
  });

  it("GET /notifications/preferences requires authentication", async () => {
    const res = await api("/notifications/preferences");

    expect(res.status).toBe(401);
  });

  it("PUT /notifications/preferences refuses to turn off a mandatory type", async () => {
    const { user, token } = await authenticatedUser();

    const res = await api("/notifications/preferences", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({ type: TYPE, channel: "email", enabled: false }),
    });

    expect(res.status).toBe(422);

    const stored = await db
      .select()
      .from(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.user_id, user.id));
    expect(stored).toHaveLength(0);
  });

  it("PUT /notifications/preferences rejects an unknown type", async () => {
    const { token } = await authenticatedUser();

    const res = await api("/notifications/preferences", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({
        type: "does_not_exist",
        channel: "email",
        enabled: false,
      }),
    });

    expect(res.status).toBe(422);
  });

  it("exposes both preference tools on the MCP surface", () => {
    const di = new NotificationDi();

    expect(di.makeGetNotificationPreferencesTool().name).toBe(
      "get_notification_preferences"
    );
    expect(di.makeUpdateNotificationPreferencesTool().name).toBe(
      "update_notification_preferences"
    );
  });

  it("PUT /notifications/preferences rejects an unknown channel", async () => {
    const { token } = await authenticatedUser();

    const res = await api("/notifications/preferences", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({
        type: "subscription_trial_ending",
        channel: "carrier_pigeon",
        enabled: false,
      }),
    });

    expect(res.status).toBe(422);
  });

  it("respects a preference the user turned off", async () => {
    const { user, token } = await authenticatedUser();

    const res = await api("/notifications/preferences", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({
        type: "subscription_trial_ending",
        channel: "email",
        enabled: false,
      }),
    });
    expect(res.status).toBe(200);

    const handler = new NotifyOnSubscriptionTrialEnding(
      new ConsoleLogger(),
      makeService()
    );

    await handler.handle(
      new SubscriptionTrialEndingEvent({
        subscription_id: crypto.randomUUID(),
        user_id: user.id,
        plan_id: crypto.randomUUID(),
        trial_ends_at: new Date("2040-06-10T12:00:00.000Z"),
      })
    );

    const rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.user_id, user.id));
    expect(rows).toHaveLength(0);
  });

  it("enqueues a trial ending notification when the preference is untouched", async () => {
    const { user } = await authenticatedUser();

    const handler = new NotifyOnSubscriptionTrialEnding(
      new ConsoleLogger(),
      makeService()
    );

    await handler.handle(
      new SubscriptionTrialEndingEvent({
        subscription_id: crypto.randomUUID(),
        user_id: user.id,
        plan_id: crypto.randomUUID(),
        trial_ends_at: new Date("2040-06-10T12:00:00.000Z"),
      })
    );

    const rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.user_id, user.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("subscription_trial_ending");
    expect(rows[0]?.body).toContain("10/06/2040");
  });

  it("enqueues a notification when a subscription payment fails", async () => {
    const { user } = await authenticatedUser();

    const handler = new NotifyOnSubscriptionPaymentFailed(
      new ConsoleLogger(),
      makeService()
    );

    await handler.handle(
      new SubscriptionPaymentFailedEvent({
        subscription_id: crypto.randomUUID(),
        user_id: user.id,
        plan_id: crypto.randomUUID(),
        grace_period_ends_at: new Date("2040-06-10T12:00:00.000Z"),
        reason: "card_declined",
      })
    );

    const rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.user_id, user.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe(TYPE);
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.body).toContain("10/06/2040");
  });
});
