import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../../../../core/infra/config/environments";
import * as schema from "./schema";

export const db = drizzle({
  connection: {
    connectionString: env.DATABASE_URL,
    // 10s: fails fast instead of hanging forever (no default) if a nested
    // query ever opens a second connection while a transaction holds the
    // first — turns a permanent pool deadlock into a loud timeout.
    connectionTimeoutMillis: 10_000,
  },
  schema,
});
