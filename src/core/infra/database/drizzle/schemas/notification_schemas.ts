import { baseSchema } from "./base_schema";
import { usersTable } from "./auth_schemas";
import {
  pgTable,
  varchar,
  uuid,
  timestamp,
  integer,
  boolean,
  text,
  index,
  unique,
} from "drizzle-orm/pg-core";

export const notificationsTable = pgTable(
  "notifications",
  {
    ...baseSchema,
    user_id: uuid()
      .references(() => usersTable.id, { onDelete: "cascade" })
      .notNull(),
    type: varchar({ length: 100 }).notNull(),
    channel: varchar({ length: 50 }).notNull(),
    title: varchar({ length: 200 }).notNull(),
    body: text().notNull(),
    status: varchar({ length: 20 }).notNull().default("pending"),
    attempts: integer().notNull().default(0),
    scheduled_for: timestamp({ withTimezone: true, mode: "date" }),
    next_attempt_at: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    sent_at: timestamp({ withTimezone: true, mode: "date" }),
    read_at: timestamp({ withTimezone: true, mode: "date" }),
    last_error: varchar({ length: 500 }),
  },
  table => [
    index("notifications_delivery_idx").on(table.status, table.next_attempt_at),
    index("notifications_user_idx").on(table.user_id, table.created_at),
  ]
);

export const notificationPreferencesTable = pgTable(
  "notification_preferences",
  {
    ...baseSchema,
    user_id: uuid()
      .references(() => usersTable.id, { onDelete: "cascade" })
      .notNull(),
    type: varchar({ length: 100 }).notNull(),
    channel: varchar({ length: 50 }).notNull(),
    enabled: boolean().notNull(),
  },
  table => [
    unique("notification_preferences_unique").on(
      table.user_id,
      table.type,
      table.channel
    ),
  ]
);
