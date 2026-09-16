import {
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { baseSchema } from "./base_schema";
import { propertiesTable } from "./property_schemas";

export const usersTable = pgTable("users", {
  ...baseSchema,
  name: varchar({ length: 255 }).notNull(),
  email: varchar({ length: 255 }).notNull().unique(),
  password: varchar({ length: 255 }).notNull(),
  role: varchar({ length: 20 }).notNull().default("user"),
  locale: varchar({ length: 20 }).notNull().default("pt-BR"),
  time_zone: varchar({ length: 64 }).notNull().default("America/Sao_Paulo"),
  password_changed_at: timestamp({ withTimezone: true, mode: "date" }),
});

export const usersRelations = relations(usersTable, ({ many }) => ({
  properties: many(propertiesTable),
}));

export const sessionsTable = pgTable(
  "sessions",
  {
    ...baseSchema,
    user_id: uuid()
      .references(() => usersTable.id, { onDelete: "cascade" })
      .notNull(),
    secret_digest: varchar({ length: 64 }).notNull().unique(),
    expires_at: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    last_used_at: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    revoked_at: timestamp({ withTimezone: true, mode: "date" }),
  },
  table => [
    index("sessions_user_id_idx").on(table.user_id),
    index("sessions_expires_at_idx").on(table.expires_at),
  ]
);

export const sessionsRelations = relations(sessionsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [sessionsTable.user_id],
    references: [usersTable.id],
  }),
}));
