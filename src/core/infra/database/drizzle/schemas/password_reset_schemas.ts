import { pgTable, varchar, uuid, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { baseSchema } from "./base_schema";
import { usersTable } from "./auth_schemas";

export const passwordResetRequestsTable = pgTable(
  "password_reset_requests",
  {
    ...baseSchema,
    // `onDelete: "cascade"` is load-bearing for PurgeUserDataUseCase (R14/LGPD).
    user_id: uuid()
      .references(() => usersTable.id, { onDelete: "cascade" })
      .notNull(),
    token_digest: varchar({ length: 64 }).notNull().unique(),
    expires_at: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    consumed_at: timestamp({ withTimezone: true, mode: "date" }),
  },
  table => [
    index("password_reset_requests_user_id_created_at_idx").on(
      table.user_id,
      table.created_at
    ),
  ]
);

export const passwordResetRequestsRelations = relations(
  passwordResetRequestsTable,
  ({ one }) => ({
    user: one(usersTable, {
      fields: [passwordResetRequestsTable.user_id],
      references: [usersTable.id],
    }),
  })
);
