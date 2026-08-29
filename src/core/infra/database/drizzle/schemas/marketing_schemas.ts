import { pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { baseSchema } from "./base_schema";

export const waitlistLeadsTable = pgTable("waitlist_leads", {
  ...baseSchema,
  name: varchar({ length: 255 }).notNull(),
  whatsapp: varchar({ length: 15 }).notNull().unique(),
  property_count: varchar({ length: 10 }).notNull(),
  source: varchar({ length: 50 }).notNull(),
  consented_at: timestamp({ withTimezone: true, mode: "date" }).notNull(),
});
