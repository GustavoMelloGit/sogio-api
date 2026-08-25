import { describe, it, expect, beforeEach } from "bun:test";
import { desc, eq } from "drizzle-orm";
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
import { NOTIFICATION_CHANNELS } from "../../src/notification/domain/notification_type/notification_type_registry";
import { NotificationDi } from "../../src/notification/infra/di/notification_di";
import type { NotificationChannel } from "../../src/notification/domain/service/notification_channel";

const TABLES = ["notifications", "notification_preferences", "users"];
const TYPE = "subscription_payment_failed";

class NoOpChannel implements NotificationChannel {
  readonly key = "email" as const;

  async deliver(): Promise<void> {}
}

const notificationRepository = new NotificationPostgresRepository();
const preferenceRepository = new NotificationPreferencePostgresRepository();

function makeService(): PersistingNotificationService {
  return new PersistingNotificationService(
    new ConsoleLogger(),
    notificationRepository,
    preferenceRepository
  );
}

function makeDelivery(): DeliverPendingNotificationsUseCase {
  return new DeliverPendingNotificationsUseCase(
    new ConsoleLogger(),
    notificationRepository,
    new NotificationContentRenderer(),
    [new NoOpChannel()]
  );
}

async function authenticatedUser() {
  const { user } = await createUserFixture({
    name: "Ana",
    email: "ana@example.com",
    password: "Password123!",
  });

  return { user, token: await createAuthToken(user.id) };
}

async function deliverNotification(
  userId: string,
  payload: Record<string, unknown> = {
    grace_period_ends_at: new Date("2040-06-10T12:00:00.000Z"),
  }
): Promise<string> {
  await makeService().notify({ user_id: userId, type: TYPE, payload });

  const [row] = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(eq(notificationsTable.user_id, userId))
    .orderBy(desc(notificationsTable.created_at))
    .limit(1);

  await makeDelivery().execute({ limit: 10 });

  return row!.id;
}

async function insertRawNotification(
  userId: string,
  overrides: Partial<{
    type: string;
    payload: Record<string, unknown>;
    status: "pending" | "sent" | "failed";
    read_at: Date | null;
    created_at: Date;
  }> = {}
): Promise<string> {
  const status = overrides.status ?? "sent";
  const createdAt = overrides.created_at ?? new Date();

  const [row] = await db
    .insert(notificationsTable)
    .values({
      user_id: userId,
      type: overrides.type ?? TYPE,
      channel: "email",
      payload:
        overrides.payload ??
        ({ grace_period_ends_at: "2040-06-10T12:00:00.000Z" } as Record<
          string,
          unknown
        >),
      status,
      attempts: 0,
      scheduled_for: null,
      next_attempt_at: createdAt,
      sent_at: status === "sent" ? createdAt : null,
      read_at: overrides.read_at ?? null,
      last_error: null,
      created_at: createdAt,
      updated_at: createdAt,
    })
    .returning({ id: notificationsTable.id });

  return row!.id;
}

type NotificationListItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

type NotificationsResponse = {
  data: NotificationListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
    has_next: boolean;
    has_previous: boolean;
  };
  unread_count: number;
};

type MarkReadResponse = { id: string; read_at: string };

async function listNotifications(
  token: string,
  query = ""
): Promise<{ status: number; body: NotificationsResponse }> {
  const res = await api(`/notifications${query}`, {
    headers: { Authorization: "Bearer " + token },
  });

  return {
    status: res.status,
    body: (await res.json()) as NotificationsResponse,
  };
}

async function markRead(
  token: string,
  notificationId: string
): Promise<{ status: number; body: MarkReadResponse }> {
  const res = await api(`/notifications/${notificationId}/read`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
  });

  return { status: res.status, body: (await res.json()) as MarkReadResponse };
}

async function markAllRead(
  token: string
): Promise<{ status: number; body: { marked_as_read: number } }> {
  const res = await api("/notifications/read-all", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
  });

  return {
    status: res.status,
    body: (await res.json()) as { marked_as_read: number },
  };
}

function formattedDate(locale: string, timeZone: string, value: Date): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}

describe("Notification inbox", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("returns a delivered notification with rendered title and body in pt-BR", async () => {
    const { user, token } = await authenticatedUser();
    const gracePeriodEndsAt = new Date("2040-06-10T12:00:00.000Z");
    await deliverNotification(user.id, {
      grace_period_ends_at: gracePeriodEndsAt,
    });

    const expectedDate = formattedDate(
      "pt-BR",
      "America/Sao_Paulo",
      gracePeriodEndsAt
    );

    const { status, body } = await listNotifications(token);

    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.title).toBe("Falha no pagamento da sua assinatura");
    expect(body.data[0]?.body).toBe(
      `Não conseguimos processar o pagamento da sua assinatura. Regularize até ${expectedDate} para não perder o acesso à plataforma.`
    );
  });

  it("renders en-US content when the user's locale is en-US", async () => {
    const { user, token } = await authenticatedUser();
    await db
      .update(usersTable)
      .set({ locale: "en-US" })
      .where(eq(usersTable.id, user.id));

    const gracePeriodEndsAt = new Date("2040-06-10T12:00:00.000Z");
    await deliverNotification(user.id, {
      grace_period_ends_at: gracePeriodEndsAt,
    });

    const expectedDate = formattedDate(
      "en-US",
      "America/Sao_Paulo",
      gracePeriodEndsAt
    );

    const { body } = await listNotifications(token);

    expect(body.data[0]?.title).toBe("Your subscription payment failed");
    expect(body.data[0]?.body).toBe(
      `We could not process your subscription payment. Settle it by ${expectedDate} to keep your access to the platform.`
    );
  });

  it("formats the date in the user's time zone", async () => {
    const { user, token } = await authenticatedUser();
    await db
      .update(usersTable)
      .set({ time_zone: "Asia/Tokyo" })
      .where(eq(usersTable.id, user.id));

    const gracePeriodEndsAt = new Date("2040-06-10T23:30:00.000Z");
    await deliverNotification(user.id, {
      grace_period_ends_at: gracePeriodEndsAt,
    });

    const tokyoDate = formattedDate("pt-BR", "Asia/Tokyo", gracePeriodEndsAt);
    const saoPauloDate = formattedDate(
      "pt-BR",
      "America/Sao_Paulo",
      gracePeriodEndsAt
    );
    expect(tokyoDate).not.toBe(saoPauloDate);

    const { body } = await listNotifications(token);

    expect(body.data[0]?.body).toContain(tokyoDate);
  });

  it("requires authentication", async () => {
    const res = await api("/notifications");

    expect(res.status).toBe(401);
  });

  it("never returns another user's notification", async () => {
    const { token } = await authenticatedUser();
    const { user: other } = await createUserFixture({
      name: "Maria",
      email: "maria@example.com",
      password: "Password123!",
    });
    await deliverNotification(other.id);

    const { body } = await listNotifications(token);

    expect(body.data).toHaveLength(0);
    expect(body.pagination.total).toBe(0);
  });

  it("omits pending rows", async () => {
    const { user, token } = await authenticatedUser();
    await makeService().notify({
      user_id: user.id,
      type: TYPE,
      payload: { grace_period_ends_at: new Date("2040-06-10T12:00:00Z") },
    });

    const { body } = await listNotifications(token);

    expect(body.data).toHaveLength(0);
    expect(body.pagination.total).toBe(0);
  });

  it("omits failed rows", async () => {
    const { user, token } = await authenticatedUser();
    await insertRawNotification(user.id, { status: "failed" });

    const { body } = await listNotifications(token);

    expect(body.data).toHaveLength(0);
    expect(body.pagination.total).toBe(0);
  });

  it("omits a row whose type left the registry", async () => {
    const { user, token } = await authenticatedUser();
    await insertRawNotification(user.id, {
      type: "does_not_exist",
      status: "sent",
    });

    const { body } = await listNotifications(token);

    expect(body.data).toHaveLength(0);
    expect(body.pagination.total).toBe(0);
  });

  it("omits a sent row whose payload no longer satisfies its type, but still counts it", async () => {
    const { user, token } = await authenticatedUser();
    await insertRawNotification(user.id, { payload: {}, status: "sent" });

    const { body } = await listNotifications(token);

    expect(body.data).toHaveLength(0);
    expect(body.pagination.total).toBe(1);
  });

  it("paginates", async () => {
    const { user, token } = await authenticatedUser();
    const now = Date.now();
    await insertRawNotification(user.id, {
      created_at: new Date(now - 3000),
    });
    await insertRawNotification(user.id, {
      created_at: new Date(now - 2000),
    });
    await insertRawNotification(user.id, {
      created_at: new Date(now - 1000),
    });

    const page1 = await listNotifications(token, "?page=1&limit=1");
    const page2 = await listNotifications(token, "?page=2&limit=1");

    expect(page1.body.data).toHaveLength(1);
    expect(page2.body.data).toHaveLength(1);
    expect(page1.body.data[0]?.id).not.toBe(page2.body.data[0]?.id);
  });

  it("orders newest first", async () => {
    const { user, token } = await authenticatedUser();
    const older = await insertRawNotification(user.id, {
      created_at: new Date("2030-01-01T00:00:00Z"),
    });
    const newer = await insertRawNotification(user.id, {
      created_at: new Date("2035-01-01T00:00:00Z"),
    });

    const { body } = await listNotifications(token, "?limit=10");

    expect(body.data.map(notification => notification.id)).toEqual([
      newer,
      older,
    ]);
  });

  it("unread_count is inbox-wide, not page-scoped", async () => {
    const { user, token } = await authenticatedUser();
    await insertRawNotification(user.id, { read_at: null });
    await insertRawNotification(user.id, { read_at: null });
    await insertRawNotification(user.id, { read_at: new Date() });

    const { body } = await listNotifications(token, "?limit=1");

    expect(body.data).toHaveLength(1);
    expect(body.unread_count).toBe(2);
  });

  it("rejects a limit above MAX_LIMIT", async () => {
    const { token } = await authenticatedUser();
    const res = await api("/notifications?limit=101", {
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(422);
  });

  it("marks a notification as read", async () => {
    const { user, token } = await authenticatedUser();
    const id = await deliverNotification(user.id);

    const before = await listNotifications(token);
    expect(before.body.unread_count).toBe(1);

    const { status, body } = await markRead(token, id);

    expect(status).toBe(200);
    expect(body.id).toBe(id);
    expect(body.read_at).not.toBeNull();

    const after = await listNotifications(token);
    expect(after.body.data[0]?.read_at).not.toBeNull();
    expect(after.body.unread_count).toBe(0);
  });

  it("marking twice returns the same read_at", async () => {
    const { user, token } = await authenticatedUser();
    const id = await deliverNotification(user.id);

    const first = await markRead(token, id);
    const second = await markRead(token, id);

    expect(second.status).toBe(200);
    expect(second.body.read_at).toBe(first.body.read_at);
  });

  it("refuses to mark another user's notification as read", async () => {
    const { token } = await authenticatedUser();
    const { user: other } = await createUserFixture({
      name: "Maria",
      email: "maria@example.com",
      password: "Password123!",
    });
    const id = await deliverNotification(other.id);

    const { status } = await markRead(token, id);
    expect(status).toBe(404);

    const rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.id, id));
    expect(rows[0]?.read_at).toBeNull();
  });

  it("returns 404, not 500, for an own pending notification", async () => {
    const { user, token } = await authenticatedUser();
    await makeService().notify({
      user_id: user.id,
      type: TYPE,
      payload: { grace_period_ends_at: new Date("2040-06-10T12:00:00Z") },
    });
    const rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.user_id, user.id));
    const id = rows[0]!.id;

    const { status } = await markRead(token, id);
    expect(status).toBe(404);
  });

  it("returns 404 for an own failed notification", async () => {
    const { user, token } = await authenticatedUser();
    const id = await insertRawNotification(user.id, { status: "failed" });

    const { status } = await markRead(token, id);
    expect(status).toBe(404);
  });

  it("returns 404 for an unknown notification id", async () => {
    const { token } = await authenticatedUser();

    const { status } = await markRead(token, crypto.randomUUID());
    expect(status).toBe(404);
  });

  it("returns 422 for a non-UUID notification id", async () => {
    const { token } = await authenticatedUser();

    const res = await api("/notifications/not-a-uuid/read", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(422);
  });

  it("exposes both inbox tools on the MCP surface", () => {
    const di = new NotificationDi();

    expect(di.makeListNotificationsTool().name).toBe("list_notifications");
    expect(di.makeMarkNotificationReadTool().name).toBe(
      "mark_notification_read"
    );
  });

  it("mark_notification_read's annotations are exactly readOnly:false, destructive:false, idempotent:true", () => {
    const di = new NotificationDi();
    const tool = di.makeMarkNotificationReadTool();

    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  it("guards against a second channel silently duplicating the listing", () => {
    expect(NOTIFICATION_CHANNELS).toEqual(["email"]);
  });
});

describe("POST /notifications/read-all", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("marks every unread delivered notification and reports how many", async () => {
    const { user, token } = await authenticatedUser();
    await deliverNotification(user.id);
    await deliverNotification(user.id);
    await deliverNotification(user.id);

    const response = await markAllRead(token);

    expect(response.status).toBe(200);
    expect(response.body.marked_as_read).toBe(3);

    const inbox = await listNotifications(token);
    expect(inbox.body.unread_count).toBe(0);
    expect(inbox.body.data.every(item => item.read_at !== null)).toBe(true);
  });

  it("reports zero on a second call and keeps the original timestamps", async () => {
    const { user, token } = await authenticatedUser();
    await deliverNotification(user.id);

    await markAllRead(token);
    const first = await listNotifications(token);

    const second = await markAllRead(token);

    expect(second.status).toBe(200);
    expect(second.body.marked_as_read).toBe(0);

    const after = await listNotifications(token);
    expect(after.body.data[0]?.read_at).toBe(first.body.data[0]!.read_at);
  });

  it("never touches a notification that was not delivered", async () => {
    const { user, token } = await authenticatedUser();
    await makeService().notify({
      user_id: user.id,
      type: TYPE,
      payload: { grace_period_ends_at: new Date("2040-06-10T12:00:00.000Z") },
    });

    const response = await markAllRead(token);

    expect(response.body.marked_as_read).toBe(0);

    const [row] = await db
      .select({ read_at: notificationsTable.read_at })
      .from(notificationsTable)
      .where(eq(notificationsTable.user_id, user.id));

    expect(row?.read_at).toBeNull();
  });

  it("never touches another user's inbox", async () => {
    const { user: owner } = await createUserFixture({
      name: "Bruno",
      email: "bruno@example.com",
      password: "Password123!",
    });
    const ownerNotificationId = await deliverNotification(owner.id);

    const { token } = await authenticatedUser();
    const response = await markAllRead(token);

    expect(response.body.marked_as_read).toBe(0);

    const [row] = await db
      .select({ read_at: notificationsTable.read_at })
      .from(notificationsTable)
      .where(eq(notificationsTable.id, ownerNotificationId));

    expect(row?.read_at).toBeNull();
  });

  it("requires authentication", async () => {
    const res = await api("/notifications/read-all", { method: "POST" });

    expect(res.status).toBe(401);
  });

  it("exposes mark_all_notifications_read on the MCP surface as idempotent", () => {
    const tool = new NotificationDi().makeMarkAllNotificationsReadTool();

    expect(tool.name).toBe("mark_all_notifications_read");
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
  });
});
