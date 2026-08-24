import { describe, it, expect, beforeEach } from "bun:test";
import { sql } from "drizzle-orm";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { db } from "../../src/core/infra/database/drizzle/database";
import { notificationsTable } from "../../src/core/infra/database/drizzle/schema";
import { NotificationPostgresRepository } from "../../src/notification/infra/database/postgres_repository/notification_postgres_repository";

const TABLES = ["notifications", "notification_preferences", "users"];
const TYPE = "subscription_payment_failed";
const BURST_SIZE = 5;

const repository = new NotificationPostgresRepository();

async function seedDeliveredBurst(
  userId: string,
  howMany: number
): Promise<string[]> {
  const sameInstant = new Date("2026-08-24T12:00:00.000Z");
  const ids = Array.from({ length: howMany }, () => crypto.randomUUID());

  await db.insert(notificationsTable).values(
    ids.map(id => ({
      id,
      user_id: userId,
      type: TYPE,
      channel: "email" as const,
      payload: {},
      status: "sent" as const,
      attempts: 1,
      scheduled_for: null,
      next_attempt_at: sameInstant,
      sent_at: sameInstant,
      read_at: null,
      last_error: null,
      created_at: sameInstant,
      updated_at: sameInstant,
      deleted_at: null,
    }))
  );

  return ids;
}

describe("notification inbox pagination", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("returns every notification exactly once while the reader marks each page read", async () => {
    const { user } = await createUserFixture({
      name: "Ana",
      email: "ana@example.com",
      password: "Password123!",
    });

    const seededIds = await seedDeliveredBurst(user.id, BURST_SIZE);

    const collected: string[] = [];

    for (let page = 1; page <= BURST_SIZE; page++) {
      const inbox = await repository.inboxOfUser(user.id, { page, limit: 1 });
      const found = inbox.data[0];
      expect(found).toBeDefined();
      collected.push(found!.id);

      const read = await repository.notificationOfId(found!.id);
      read!.markRead();
      await repository.save(read!);

      await db.execute(sql`VACUUM notifications`);
    }

    expect([...collected].sort()).toEqual([...seededIds].sort());
  });
});
