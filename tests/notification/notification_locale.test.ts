import { describe, it, expect, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { db } from "../../src/core/infra/database/drizzle/database";
import {
  notificationsTable,
  usersTable,
} from "../../src/core/infra/database/drizzle/schema";
import { ConsoleLogger } from "../../src/core/infra/logger/console_logger";
import { NotificationPostgresRepository } from "../../src/notification/infra/database/postgres_repository/notification_postgres_repository";
import { NotificationPreferencePostgresRepository } from "../../src/notification/infra/database/postgres_repository/notification_preference_postgres_repository";
import { PersistingNotificationService } from "../../src/notification/application/service/persisting_notification_service";
import { DeliverPendingNotificationsUseCase } from "../../src/notification/application/use_case/deliver_pending_notifications";
import { NotificationContentRenderer } from "../../src/notification/domain/service/notification_content_renderer";
import type { Notification } from "../../src/notification/domain/entity/notification";
import type { NotificationContent } from "../../src/notification/domain/notification_type/notification_type_registry";
import type {
  NotificationChannel,
  NotificationRecipient,
} from "../../src/notification/domain/service/notification_channel";

const TABLES = ["notifications", "notification_preferences", "users"];
const TYPE = "subscription_payment_failed";
const GRACE_PERIOD_END = new Date("2040-06-10T12:00:00.000Z");

class RecordingChannel implements NotificationChannel {
  readonly key = "email" as const;
  readonly delivered: Array<{
    recipient: NotificationRecipient;
    content: NotificationContent;
  }> = [];

  async deliver(
    _notification: Notification,
    recipient: NotificationRecipient,
    content: NotificationContent
  ): Promise<void> {
    this.delivered.push({ recipient, content });
  }
}

const notificationRepository = new NotificationPostgresRepository();
const preferenceRepository = new NotificationPreferencePostgresRepository();

function makeService() {
  return new PersistingNotificationService(
    new ConsoleLogger(),
    notificationRepository,
    preferenceRepository
  );
}

function makeDelivery(channel: NotificationChannel) {
  return new DeliverPendingNotificationsUseCase(
    new ConsoleLogger(),
    notificationRepository,
    new NotificationContentRenderer(),
    [channel]
  );
}

async function makeUser() {
  const { user } = await createUserFixture({
    name: "João Silva",
    email: "joao@sogio.dev",
    password: "password123",
  });

  return { user, token: await createAuthToken(user.id) };
}

async function setPreferences(
  userId: string,
  preferences: { locale: string; time_zone: string }
) {
  await db.update(usersTable).set(preferences).where(eq(usersTable.id, userId));
}

async function enqueue(userId: string) {
  await makeService().notify({
    user_id: userId,
    type: TYPE,
    payload: { grace_period_ends_at: GRACE_PERIOD_END },
  });
}

describe("Notification locale", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("renders in Portuguese for a user who never configured a preference", async () => {
    const { user } = await makeUser();
    await enqueue(user.id);

    const channel = new RecordingChannel();
    await makeDelivery(channel).execute({ limit: 10 });

    expect(channel.delivered[0]?.content.title).toBe(
      "Falha no pagamento da sua assinatura"
    );
    expect(channel.delivered[0]?.content.body).toContain("10/06/2040");
  });

  it("renders in the language the user chose", async () => {
    const { user } = await makeUser();
    await setPreferences(user.id, {
      locale: "en-US",
      time_zone: "America/Sao_Paulo",
    });
    await enqueue(user.id);

    const channel = new RecordingChannel();
    await makeDelivery(channel).execute({ limit: 10 });

    expect(channel.delivered[0]?.content.title).toBe(
      "Your subscription payment failed"
    );
    expect(channel.delivered[0]?.content.body).toContain("06/10/2040");
  });

  it("formats the date in the time zone the user chose, not a fixed one", async () => {
    const { user } = await makeUser();
    await setPreferences(user.id, {
      locale: "pt-BR",
      time_zone: "Pacific/Kiritimati",
    });
    await makeService().notify({
      user_id: user.id,
      type: TYPE,
      payload: { grace_period_ends_at: new Date("2040-06-10T22:00:00.000Z") },
    });

    const channel = new RecordingChannel();
    await makeDelivery(channel).execute({ limit: 10 });

    expect(channel.delivered[0]?.content.body).toContain("11/06/2040");
  });

  it("uses the language current at delivery, not at creation", async () => {
    const { user } = await makeUser();
    await enqueue(user.id);
    await setPreferences(user.id, {
      locale: "en-US",
      time_zone: "America/Sao_Paulo",
    });

    const channel = new RecordingChannel();
    await makeDelivery(channel).execute({ limit: 10 });

    expect(channel.delivered[0]?.content.title).toBe(
      "Your subscription payment failed"
    );
  });

  it("refuses to enqueue a notification whose payload breaks the type contract", async () => {
    const { user } = await makeUser();

    await makeService().notify({
      user_id: user.id,
      type: TYPE,
      payload: { grace_period_ends_at: "not a date" },
    });

    const rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.user_id, user.id));

    expect(rows).toHaveLength(0);
  });

  it("fails an unrenderable notification alone, without holding up the batch", async () => {
    const { user: broken } = await createUserFixture({
      name: "Maria",
      email: "maria@sogio.dev",
      password: "password123",
    });
    const { user: healthy } = await makeUser();

    await enqueue(broken.id);
    await db
      .update(notificationsTable)
      .set({ payload: {} })
      .where(eq(notificationsTable.user_id, broken.id));
    await enqueue(healthy.id);

    const channel = new RecordingChannel();
    const result = await makeDelivery(channel).execute({ limit: 10 });

    expect(result).toEqual({ delivered: 1, failed: 1 });
    expect(channel.delivered).toHaveLength(1);
    expect(channel.delivered[0]?.recipient.user_id).toBe(healthy.id);
  });

  it("keeps user-facing text out of the handlers (I-N1)", () => {
    const handlers = [
      "src/notification/application/handler/notify_on_subscription_payment_failed.ts",
      "src/notification/application/handler/notify_on_subscription_trial_ending.ts",
    ];

    for (const handler of handlers) {
      const source = readFileSync(handler, "utf-8");

      expect(source).not.toContain("title:");
      expect(source).not.toContain("body:");
      expect(source).not.toContain("Intl.DateTimeFormat");
    }
  });

  it("localizes the notification type labels served to the user", async () => {
    const { user, token } = await makeUser();
    await setPreferences(user.id, {
      locale: "en-US",
      time_zone: "America/Sao_Paulo",
    });

    const res = await api("/notifications/preferences", {
      headers: { Authorization: "Bearer " + token },
    });

    const body = (await res.json()) as {
      preferences: Array<{ type: string; label: string }>;
    };

    expect(body.preferences.find(item => item.type === TYPE)?.label).toBe(
      "Subscription payment failure"
    );
  });
});
