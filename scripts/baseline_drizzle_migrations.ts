import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../src/core/infra/database/drizzle/database";

/**
 * One-time cutover for databases that were provisioned entirely via
 * `drizzle-kit push` (no migration history) and are switching to
 * `drizzle-kit migrate` for the first time.
 *
 * `drizzle-kit migrate` tracks progress in `drizzle.__drizzle_migrations`
 * and applies every migration newer than the last recorded one. A database
 * with no history would replay every migration from `0000` onward,
 * including `CREATE TABLE` statements for tables that already exist from
 * prior `push` runs, and fail.
 *
 * This script marks `0003_tired_jocasta` — the last migration whose schema
 * was already applied via `push` before this project switched to
 * `migrate` — as done, so `migrate` only applies what comes after it. It
 * is a no-op (does nothing, exits 0) once the tracking table already has
 * any row, so it is safe to run on every deploy.
 */
const BASELINE_TAG = "0003_tired_jocasta";
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

async function main() {
  const journalPath = path.join(
    import.meta.dir,
    "..",
    "drizzle",
    "meta",
    "_journal.json"
  );
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as {
    entries: { tag: string; when: number }[];
  };
  const baselineEntry = journal.entries.find(e => e.tag === BASELINE_TAG);
  if (!baselineEntry) {
    throw new Error(
      `Baseline migration "${BASELINE_TAG}" not found in ${journalPath}`
    );
  }

  const migrationSqlPath = path.join(
    import.meta.dir,
    "..",
    "drizzle",
    `${BASELINE_TAG}.sql`
  );
  const migrationSql = fs.readFileSync(migrationSqlPath, "utf-8");
  const hash = crypto.createHash("sha256").update(migrationSql).digest("hex");

  const tableExists = await db.execute<{ exists: boolean }>(sql`
    select exists (
      select 1 from information_schema.tables
      where table_schema = ${MIGRATIONS_SCHEMA} and table_name = ${MIGRATIONS_TABLE}
    ) as "exists"
  `);

  if (tableExists.rows[0]?.exists) {
    const existingRows = await db.execute<{ count: number }>(
      sql.raw(
        `select count(*)::int as count from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`
      )
    );
    if ((existingRows.rows[0]?.count ?? 0) > 0) {
      console.log(
        "[baseline] Migrations table already has history — nothing to do."
      );
      return;
    }
  }

  await db.execute(sql.raw(`create schema if not exists ${MIGRATIONS_SCHEMA}`));
  await db.execute(
    sql.raw(`
      create table if not exists ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (
        id serial primary key,
        hash text not null,
        created_at bigint
      )
    `)
  );
  await db.execute(
    sql`insert into ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)} ("hash", "created_at") values (${hash}, ${baselineEntry.when})`
  );

  console.log(
    `[baseline] Marked "${BASELINE_TAG}" as applied. "drizzle-kit migrate" will only run migrations after it.`
  );
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("[baseline] Failed:", error);
    process.exit(1);
  });
