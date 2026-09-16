import { describe, it, expect, beforeEach } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { db } from "../../src/core/infra/database/drizzle/database";
import { subscriptionsTable } from "../../src/core/infra/database/drizzle/schema";

const TABLES = ["properties", "addresses", "users"];
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

async function planChoiceMigrationSql(): Promise<string> {
  const glob = new Bun.Glob("drizzle/*.sql");

  for await (const path of glob.scan(".")) {
    const content = await Bun.file(path).text();
    if (content.includes('ADD COLUMN "plan_chosen_at"')) {
      return content;
    }
  }

  throw new Error("migration adding plan_chosen_at not found");
}

async function runBackfillStatements(migration: string): Promise<void> {
  const updates = migration
    .split(STATEMENT_BREAKPOINT)
    .map(statement => statement.trim())
    .filter(statement => statement.startsWith("UPDATE"));

  expect(updates.length).toBeGreaterThan(0);

  for (const statement of updates) {
    await db.execute(sql.raw(statement));
  }
}

async function subscriptionRowOf(userId: string) {
  const row = await db.query.subscriptionsTable.findFirst({
    where: eq(subscriptionsTable.user_id, userId),
  });
  if (!row) throw new Error("test setup: no subscription row");
  return row;
}

describe("plan_chosen_at backfill migration", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("marks every existing subscription as already chosen at its creation", async () => {
    const { user } = await createUserFixture({
      name: "Conta Existente",
      email: "plan-choice.backfill.existing@sogio.dev",
      password: "password123",
    });
    const createdAt = new Date("2025-11-03T14:30:00.000Z");
    await db
      .update(subscriptionsTable)
      .set({ created_at: createdAt, plan_chosen_at: null })
      .where(eq(subscriptionsTable.user_id, user.id));

    await runBackfillStatements(await planChoiceMigrationSql());

    const row = await subscriptionRowOf(user.id);
    expect(row.plan_chosen_at).toEqual(createdAt);
  });

  it("leaves an already recorded choice untouched", async () => {
    const { user } = await createUserFixture({
      name: "Conta Com Escolha",
      email: "plan-choice.backfill.recorded@sogio.dev",
      password: "password123",
    });
    const chosenAt = new Date("2026-01-05T09:00:00.000Z");
    await db
      .update(subscriptionsTable)
      .set({
        created_at: new Date("2025-12-01T00:00:00.000Z"),
        plan_chosen_at: chosenAt,
      })
      .where(eq(subscriptionsTable.user_id, user.id));

    await runBackfillStatements(await planChoiceMigrationSql());

    const row = await subscriptionRowOf(user.id);
    expect(row.plan_chosen_at).toEqual(chosenAt);
  });
});
