import { describe, it, expect, beforeEach } from "bun:test";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { db } from "../../src/core/infra/database/drizzle/database";
import { notificationsTable } from "../../src/core/infra/database/drizzle/schema";
import { NotificationPostgresRepository } from "../../src/notification/infra/database/postgres_repository/notification_postgres_repository";
import { NotificationInboxPolicy } from "../../src/notification/domain/policy/notification_inbox_policy";
import {
  Notification,
  notificationSchema,
  type NotificationStatus,
} from "../../src/notification/domain/entity/notification";

const TABLES = ["notifications", "notification_preferences", "users"];
const KNOWN_TYPE = "subscription_payment_failed";
const RETIRED_TYPE = "retired_type";

const repository = new NotificationPostgresRepository();

type Row = {
  status: NotificationStatus;
  type: string;
  deleted: boolean;
  readAt: Date | null;
};

const ROWS: Row[] = [
  { status: "sent", type: KNOWN_TYPE, deleted: false, readAt: null },
  { status: "sent", type: KNOWN_TYPE, deleted: false, readAt: new Date() },
  { status: "pending", type: KNOWN_TYPE, deleted: false, readAt: null },
  { status: "failed", type: KNOWN_TYPE, deleted: false, readAt: null },
  { status: "sent", type: RETIRED_TYPE, deleted: false, readAt: null },
  { status: "sent", type: KNOWN_TYPE, deleted: true, readAt: null },
];

async function seedEveryShape(userId: string): Promise<Notification[]> {
  const instant = new Date("2026-08-24T12:00:00.000Z");

  const rows = ROWS.map((row, index) => ({
    id: crypto.randomUUID(),
    user_id: userId,
    type: row.type,
    channel: "email" as const,
    payload: {},
    status: row.status,
    attempts: row.status === "sent" ? 1 : 0,
    scheduled_for: null,
    next_attempt_at: instant,
    sent_at: row.status === "sent" ? instant : null,
    read_at: row.readAt,
    last_error: null,
    created_at: new Date(instant.getTime() - index * 1000),
    updated_at: instant,
    deleted_at: row.deleted ? instant : null,
  }));

  await db.insert(notificationsTable).values(rows);

  return rows.map(row =>
    Notification.reconstitute(notificationSchema.parse(row))
  );
}

describe("notification inbox scope", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("serves exactly the notifications the domain policy says belong to the inbox", async () => {
    const { user } = await createUserFixture({
      name: "Ana",
      email: "ana@example.com",
      password: "Password123!",
    });
    const seeded = await seedEveryShape(user.id);

    const inbox = await repository.inboxOfUser(user.id, { page: 1, limit: 50 });

    const servedIds = inbox.data.map(item => item.id).sort();
    const allowedIds = seeded
      .filter(item => NotificationInboxPolicy.belongsToInbox(item))
      .map(item => item.id)
      .sort();

    expect(allowedIds.length).toBeGreaterThan(0);
    expect(servedIds).toEqual(allowedIds);
    expect(inbox.pagination.total).toBe(allowedIds.length);
  });

  it("counts as unread exactly what the domain policy says is unread", async () => {
    const { user } = await createUserFixture({
      name: "Ana",
      email: "ana@example.com",
      password: "Password123!",
    });
    const seeded = await seedEveryShape(user.id);

    const inbox = await repository.inboxOfUser(user.id, { page: 1, limit: 50 });

    const expected = seeded.filter(item =>
      NotificationInboxPolicy.isUnread(item)
    ).length;

    expect(expected).toBeGreaterThan(0);
    expect(inbox.unread_count).toBe(expected);
  });

  it("marks read exactly what the domain policy says is unread, and nothing else", async () => {
    const { user } = await createUserFixture({
      name: "Ana",
      email: "ana@example.com",
      password: "Password123!",
    });
    const seeded = await seedEveryShape(user.id);

    const marked = await repository.markInboxReadOfUser(user.id);

    const expected = seeded.filter(item =>
      NotificationInboxPolicy.isUnread(item)
    );

    expect(marked).toBe(expected.length);

    const untouched = seeded.filter(
      item => !NotificationInboxPolicy.isUnread(item) && item.read_at === null
    );

    const rows = await db.select().from(notificationsTable);
    const byId = new Map(rows.map(row => [row.id, row]));

    expected.forEach(item => {
      expect(byId.get(item.id)?.read_at).not.toBeNull();
    });
    untouched.forEach(item => {
      expect(byId.get(item.id)?.read_at).toBeNull();
    });
  });
});
