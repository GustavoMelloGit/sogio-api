import { ensureTestDatabase } from "./test_database";

process.env.DATABASE_URL = await ensureTestDatabase();
