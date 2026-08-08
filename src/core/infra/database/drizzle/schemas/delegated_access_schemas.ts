import {
  pgTable,
  varchar,
  text,
  uuid,
  timestamp,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { baseSchema } from "./base_schema";
import { usersTable } from "./auth_schemas";

export const appRegistrationsTable = pgTable("app_registrations", {
  ...baseSchema,
  client_name: varchar({ length: 255 }).notNull(),
  redirect_uris: text().array().notNull(),
  token_endpoint_auth_method: varchar({ length: 20 })
    .notNull()
    .default("none"),
});

export const appRegistrationsRelations = relations(
  appRegistrationsTable,
  ({ many }) => ({
    consents: many(consentsTable),
    authorizationRequests: many(authorizationRequestsTable),
    authorizationCodes: many(authorizationCodesTable),
  })
);

export const consentsTable = pgTable("consents", {
  ...baseSchema,
  user_id: uuid()
    .references(() => usersTable.id, { onDelete: "cascade" })
    .notNull(),
  app_registration_id: uuid()
    .references(() => appRegistrationsTable.id, { onDelete: "cascade" })
    .notNull(),
  scope: varchar({ length: 255 }).notNull(),
  granted_at: timestamp({ withTimezone: true, mode: "date" }).notNull(),
  last_used_at: timestamp({ withTimezone: true, mode: "date" }).notNull(),
  revoked_at: timestamp({ withTimezone: true, mode: "date" }),
});

export const consentsRelations = relations(consentsTable, ({ one, many }) => ({
  user: one(usersTable, {
    fields: [consentsTable.user_id],
    references: [usersTable.id],
  }),
  appRegistration: one(appRegistrationsTable, {
    fields: [consentsTable.app_registration_id],
    references: [appRegistrationsTable.id],
  }),
  authorizationCodes: many(authorizationCodesTable),
  issuedCredentials: many(issuedCredentialsTable),
}));

export const authorizationRequestsTable = pgTable("authorization_requests", {
  ...baseSchema,
  identifier_digest: varchar({ length: 64 }).notNull().unique(),
  app_registration_id: uuid()
    .references(() => appRegistrationsTable.id, { onDelete: "cascade" })
    .notNull(),
  redirect_uri: varchar({ length: 2048 }).notNull(),
  code_challenge: varchar({ length: 255 }).notNull(),
  code_challenge_method: varchar({ length: 10 }).notNull(),
  scope: varchar({ length: 255 }).notNull(),
  resource: varchar({ length: 512 }).notNull(),
  state: varchar({ length: 512 }),
  expires_at: timestamp({ withTimezone: true, mode: "date" }).notNull(),
  consumed_at: timestamp({ withTimezone: true, mode: "date" }),
});

export const authorizationRequestsRelations = relations(
  authorizationRequestsTable,
  ({ one }) => ({
    appRegistration: one(appRegistrationsTable, {
      fields: [authorizationRequestsTable.app_registration_id],
      references: [appRegistrationsTable.id],
    }),
  })
);

export const authorizationCodesTable = pgTable("authorization_codes", {
  ...baseSchema,
  code_digest: varchar({ length: 64 }).notNull().unique(),
  app_registration_id: uuid()
    .references(() => appRegistrationsTable.id, { onDelete: "cascade" })
    .notNull(),
  consent_id: uuid()
    .references(() => consentsTable.id, { onDelete: "cascade" })
    .notNull(),
  redirect_uri: varchar({ length: 2048 }).notNull(),
  code_challenge: varchar({ length: 255 }).notNull(),
  code_challenge_method: varchar({ length: 10 }).notNull(),
  scope: varchar({ length: 255 }).notNull(),
  resource: varchar({ length: 512 }).notNull(),
  expires_at: timestamp({ withTimezone: true, mode: "date" }).notNull(),
  consumed_at: timestamp({ withTimezone: true, mode: "date" }),
});

export const authorizationCodesRelations = relations(
  authorizationCodesTable,
  ({ one }) => ({
    appRegistration: one(appRegistrationsTable, {
      fields: [authorizationCodesTable.app_registration_id],
      references: [appRegistrationsTable.id],
    }),
    consent: one(consentsTable, {
      fields: [authorizationCodesTable.consent_id],
      references: [consentsTable.id],
    }),
  })
);

export const issuedCredentialsTable = pgTable(
  "issued_credentials",
  {
    ...baseSchema,
    consent_id: uuid()
      .references(() => consentsTable.id, { onDelete: "cascade" })
      .notNull(),
    family_id: uuid().notNull(),
    access_token_digest: varchar({ length: 64 }).notNull().unique(),
    access_token_expires_at: timestamp({
      withTimezone: true,
      mode: "date",
    }).notNull(),
    refresh_token_digest: varchar({ length: 64 }).notNull().unique(),
    refresh_token_expires_at: timestamp({
      withTimezone: true,
      mode: "date",
    }).notNull(),
    resource: varchar({ length: 512 }).notNull(),
    /**
     * Set only on the first credential of a family, minted directly by
     * `/token`'s `authorization_code` grant — never on a rotation successor.
     * Lets a code-reuse attempt (`AuthorizationCodeRepository.claim`
     * returning zero rows) resolve to the family it must revoke (E4),
     * without the authorization_codes table needing to know about it.
     * Unique because a given code can only ever mint one family — multiple
     * `NULL`s (every rotation successor) don't conflict with a unique
     * constraint in Postgres.
     */
    authorization_code_digest: varchar({ length: 64 }).unique(),
    rotated_at: timestamp({ withTimezone: true, mode: "date" }),
    successor_id: uuid().references(
      (): AnyPgColumn => issuedCredentialsTable.id,
      { onDelete: "set null" }
    ),
    revoked_at: timestamp({ withTimezone: true, mode: "date" }),
  },
  table => [index("issued_credentials_family_id_idx").on(table.family_id)]
);

export const issuedCredentialsRelations = relations(
  issuedCredentialsTable,
  ({ one }) => ({
    consent: one(consentsTable, {
      fields: [issuedCredentialsTable.consent_id],
      references: [consentsTable.id],
    }),
    successor: one(issuedCredentialsTable, {
      fields: [issuedCredentialsTable.successor_id],
      references: [issuedCredentialsTable.id],
    }),
  })
);
