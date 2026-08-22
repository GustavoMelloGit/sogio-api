import { describe, it, expect, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { db } from "../../src/core/infra/database/drizzle/database";
import {
  notificationsTable,
  notificationPreferencesTable,
  usersTable,
} from "../../src/core/infra/database/drizzle/schema";
import { ConsoleLogger } from "../../src/core/infra/logger/console_logger";
import { NotificationPostgresRepository } from "../../src/notification/infra/database/postgres_repository/notification_postgres_repository";
import { NotificationPreferencePostgresRepository } from "../../src/notification/infra/database/postgres_repository/notification_preference_postgres_repository";
import { PersistingNotificationService } from "../../src/notification/application/service/persisting_notification_service";
import { DeliverPendingNotificationsUseCase } from "../../src/notification/application/use_case/deliver_pending_notifications";
import { MAX_DELIVERY_ATTEMPTS } from "../../src/notification/domain/entity/notification";
import type {
  NotificationChannel,
  NotificationRecipient,
} from "../../src/notification/domain/service/notification_channel";
import type { Notification } from "../../src/notification/domain/entity/notification";
import { NotificationContentRenderer } from "../../src/notification/domain/service/notification_content_renderer";
import type { NotificationContent } from "../../src/notification/domain/notification_type/notification_type_registry";
import type { NotificationTypeKey } from "../../src/notification/domain/notification_type/notification_type_registry";
import "../helpers/server";

const TABLES = ["notifications", "notification_preferences", "users"];
const TYPE = "subscription_payment_failed";

class RecordingChannel implements NotificationChannel {
  readonly key = "email" as const;
  readonly delivered: Array<{
    notification: Notification;
    recipient: NotificationRecipient;
    content: NotificationContent;
  }> = [];

  constructor(private readonly failWith?: string) {}

  async deliver(
    notification: Notification,
    recipient: NotificationRecipient,
    content: NotificationContent
  ): Promise<void> {
    if (this.failWith) {
      throw new Error(this.failWith);
    }

    this.delivered.push({ notification, recipient, content });
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

  return user;
}

async function rowsOf(userId: string) {
  return db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.user_id, userId));
}

describe("Notification delivery", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("persists a pending notification instead of delivering inline", async () => {
    const user = await makeUser();

    await makeService().notify({
      user_id: user.id,
      type: TYPE,
      payload: { grace_period_ends_at: new Date("2040-06-10T12:00:00Z") },
    });

    const rows = await rowsOf(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.channel).toBe("email");
    expect(rows[0]?.sent_at).toBeNull();
  });

  it("delivers a pending notification to the channel and marks it sent", async () => {
    const user = await makeUser();
    await makeService().notify({
      user_id: user.id,
      type: TYPE,
      payload: { grace_period_ends_at: new Date("2040-06-10T12:00:00Z") },
    });

    const channel = new RecordingChannel();
    const result = await makeDelivery(channel).execute({ limit: 10 });

    expect(result).toEqual({ delivered: 1, failed: 0 });
    expect(channel.delivered).toHaveLength(1);
    expect(channel.delivered[0]?.recipient.email).toBe("joao@sogio.dev");
    expect(channel.delivered[0]?.recipient.name).toBe("João Silva");

    const rows = await rowsOf(user.id);
    expect(rows[0]?.status).toBe("sent");
    expect(rows[0]?.sent_at).not.toBeNull();
  });

  it("never delivers the same notification twice", async () => {
    const user = await makeUser();
    await makeService().notify({
      user_id: user.id,
      type: TYPE,
      payload: { grace_period_ends_at: new Date("2040-06-10T12:00:00Z") },
    });

    const channel = new RecordingChannel();
    const delivery = makeDelivery(channel);

    await delivery.execute({ limit: 10 });
    const second = await delivery.execute({ limit: 10 });

    expect(second).toEqual({ delivered: 0, failed: 0 });
    expect(channel.delivered).toHaveLength(1);
  });

  it("keeps a failed delivery pending and schedules a retry in the future", async () => {
    const user = await makeUser();
    await makeService().notify({
      user_id: user.id,
      type: TYPE,
      payload: { grace_period_ends_at: new Date("2040-06-10T12:00:00Z") },
    });

    const result = await makeDelivery(
      new RecordingChannel("smtp is down")
    ).execute({ limit: 10 });

    expect(result).toEqual({ delivered: 0, failed: 1 });

    const rows = await rowsOf(user.id);
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.attempts).toBe(1);
    expect(rows[0]?.last_error).toBe("smtp is down");
    expect(rows[0]?.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
  });

  it("gives up after the attempt ceiling and stops retrying", async () => {
    const user = await makeUser();
    await makeService().notify({
      user_id: user.id,
      type: TYPE,
      payload: { grace_period_ends_at: new Date("2040-06-10T12:00:00Z") },
    });

    const delivery = makeDelivery(new RecordingChannel("smtp is down"));

    for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS; attempt++) {
      await db
        .update(notificationsTable)
        .set({ next_attempt_at: new Date(Date.now() - 1000) })
        .where(eq(notificationsTable.user_id, user.id));

      await delivery.execute({ limit: 10 });
    }

    const rows = await rowsOf(user.id);
    expect(rows[0]?.status).toBe("failed");
    expect(rows[0]?.attempts).toBe(MAX_DELIVERY_ATTEMPTS);

    const afterGivingUp = await delivery.execute({ limit: 10 });
    expect(afterGivingUp).toEqual({ delivered: 0, failed: 0 });
  });

  it("does not deliver a notification scheduled for the future", async () => {
    const user = await makeUser();

    await makeService().notify({
      user_id: user.id,
      type: TYPE,
      payload: { grace_period_ends_at: new Date("2040-06-10T12:00:00Z") },
      scheduled_for: new Date(Date.now() + 60 * 60 * 1000),
    });

    const channel = new RecordingChannel();
    const result = await makeDelivery(channel).execute({ limit: 10 });

    expect(result).toEqual({ delivered: 0, failed: 0 });
    expect(channel.delivered).toHaveLength(0);

    const rows = await rowsOf(user.id);
    expect(rows[0]?.status).toBe("pending");
  });

  it("ignores a type missing from the registry instead of throwing", async () => {
    const user = await makeUser();

    await makeService().notify({
      user_id: user.id,
      type: "does_not_exist" as NotificationTypeKey,
      payload: { grace_period_ends_at: new Date("2040-06-10T12:00:00Z") },
    });

    expect(await rowsOf(user.id)).toHaveLength(0);
  });

  it("deletes notifications and preferences when the user is purged (LGPD)", async () => {
    const user = await makeUser();
    await makeService().notify({
      user_id: user.id,
      type: TYPE,
      payload: { grace_period_ends_at: new Date("2040-06-10T12:00:00Z") },
    });

    await db.insert(notificationPreferencesTable).values({
      user_id: user.id,
      type: TYPE,
      channel: "email",
      enabled: false,
    });

    await db.delete(usersTable).where(eq(usersTable.id, user.id));

    expect(await rowsOf(user.id)).toHaveLength(0);
    const preferences = await db
      .select()
      .from(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.user_id, user.id));
    expect(preferences).toHaveLength(0);
  });
});
