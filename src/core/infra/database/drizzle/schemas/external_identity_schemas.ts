import {
  pgTable,
  varchar,
  uuid,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { baseSchema } from "./base_schema";
import { usersTable } from "./auth_schemas";

export const linkedIdentitiesTable = pgTable(
  "linked_identities",
  {
    ...baseSchema,
    user_id: uuid()
      .references(() => usersTable.id, { onDelete: "cascade" })
      .notNull(),
    provider: varchar({ length: 20 }).notNull(),
    subject: varchar({ length: 255 }).notNull(),
  },
  table => [
    uniqueIndex("linked_identities_provider_subject_idx").on(
      table.provider,
      table.subject
    ),
    uniqueIndex("linked_identities_user_id_provider_idx").on(
      table.user_id,
      table.provider
    ),
  ]
);

export const linkedIdentitiesRelations = relations(
  linkedIdentitiesTable,
  ({ one }) => ({
    user: one(usersTable, {
      fields: [linkedIdentitiesTable.user_id],
      references: [usersTable.id],
    }),
  })
);

export const externalSignInRequestsTable = pgTable(
  "external_sign_in_requests",
  {
    ...baseSchema,
    provider: varchar({ length: 20 }).notNull(),
    state_digest: varchar({ length: 64 }).notNull().unique(),
    code_challenge: varchar({ length: 255 }).notNull(),
    nonce_digest: varchar({ length: 64 }).notNull(),
    return_to: varchar({ length: 512 }),
    expires_at: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    consumed_at: timestamp({ withTimezone: true, mode: "date" }),
  },
  table => [
    index("external_sign_in_requests_expires_at_idx").on(table.expires_at),
  ]
);
