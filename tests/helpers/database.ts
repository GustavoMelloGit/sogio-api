import { sql } from "drizzle-orm";
import { db } from "../../src/core/infra/database/drizzle/database";
import { env } from "../../src/core/infra/config/environments";
import { resetSharedRateLimiter } from "../../src/core/infra/di/core_di";

export async function truncate(tables: string[]): Promise<void> {
  const dbName = new URL(env.DATABASE_URL).pathname.slice(1);
  if (env.NODE_ENV !== "test" || !dbName.includes("test")) {
    throw new Error(
      "truncate() can only run against a test database (NODE_ENV=test and database name must contain 'test')"
    );
  }

  const tableRefs = tables.map(t => sql.identifier(t));
  const tableList = sql.join(tableRefs, sql.raw(", "));
  await db.execute(sql`TRUNCATE ${tableList} RESTART IDENTITY CASCADE`);
  resetSharedRateLimiter();
}
