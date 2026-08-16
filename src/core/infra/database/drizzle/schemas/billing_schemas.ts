import {
  pgTable,
  varchar,
  integer,
  uuid,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { baseSchema } from "./base_schema";
import { usersTable } from "./auth_schemas";

export const plansTable = pgTable("plans", {
  ...baseSchema,
  code: varchar({ length: 50 }).notNull().unique(),
  name: varchar({ length: 100 }).notNull(),
  price_amount: integer().notNull(),
  billing_interval: varchar({ length: 20 }).notNull(),
  max_properties: integer().notNull(),
  trial_days: integer().notNull(),
  external_price_reference: varchar({ length: 255 }),
});

export const subscriptionsTable = pgTable("subscriptions", {
  ...baseSchema,
  user_id: uuid()
    .references(() => usersTable.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  plan_id: uuid()
    .references(() => plansTable.id)
    .notNull(),
  status: varchar({ length: 20 }).notNull(),
  current_period_start: timestamp({ withTimezone: true, mode: "date" }),
  current_period_end: timestamp({ withTimezone: true, mode: "date" }),
  trial_ends_at: timestamp({ withTimezone: true, mode: "date" }),
  canceled_at: timestamp({ withTimezone: true, mode: "date" }),
  grace_period_ends_at: timestamp({ withTimezone: true, mode: "date" }),
  external_reference: varchar({ length: 255 }),
  external_customer_reference: varchar({ length: 255 }),
});

export const subscriptionHistoryEntriesTable = pgTable(
  "subscription_history_entries",
  {
    ...baseSchema,
    // Both FKs of identity are `ON DELETE cascade` — LGPD account deletion
    // (`PurgeUserDataUseCase`) must not fail on orphaned history rows.
    subscription_id: uuid()
      .references(() => subscriptionsTable.id, { onDelete: "cascade" })
      .notNull(),
    user_id: uuid()
      .references(() => usersTable.id, { onDelete: "cascade" })
      .notNull(),
    plan_id: uuid()
      .references(() => plansTable.id)
      .notNull(),
    type: varchar({ length: 30 }).notNull(),
    resulting_status: varchar({ length: 20 }).notNull(),
    occurred_at: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    access_until: timestamp({ withTimezone: true, mode: "date" }),
    reason: varchar({ length: 255 }),
  },
  table => [
    index("subscription_history_entries_user_id_occurred_at_idx").on(
      table.user_id,
      table.occurred_at.desc()
    ),
  ]
);

export const plansRelations = relations(plansTable, ({ many }) => ({
  subscriptions: many(subscriptionsTable),
}));

export const subscriptionsRelations = relations(
  subscriptionsTable,
  ({ one, many }) => ({
    user: one(usersTable, {
      fields: [subscriptionsTable.user_id],
      references: [usersTable.id],
    }),
    plan: one(plansTable, {
      fields: [subscriptionsTable.plan_id],
      references: [plansTable.id],
    }),
    historyEntries: many(subscriptionHistoryEntriesTable),
  })
);

export const subscriptionHistoryEntriesRelations = relations(
  subscriptionHistoryEntriesTable,
  ({ one }) => ({
    subscription: one(subscriptionsTable, {
      fields: [subscriptionHistoryEntriesTable.subscription_id],
      references: [subscriptionsTable.id],
    }),
    user: one(usersTable, {
      fields: [subscriptionHistoryEntriesTable.user_id],
      references: [usersTable.id],
    }),
    plan: one(plansTable, {
      fields: [subscriptionHistoryEntriesTable.plan_id],
      references: [plansTable.id],
    }),
  })
);
