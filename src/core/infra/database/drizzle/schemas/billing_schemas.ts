import { pgTable, varchar, integer, uuid, timestamp } from "drizzle-orm/pg-core";
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

export const plansRelations = relations(plansTable, ({ many }) => ({
  subscriptions: many(subscriptionsTable),
}));

export const subscriptionsRelations = relations(
  subscriptionsTable,
  ({ one }) => ({
    user: one(usersTable, {
      fields: [subscriptionsTable.user_id],
      references: [usersTable.id],
    }),
    plan: one(plansTable, {
      fields: [subscriptionsTable.plan_id],
      references: [plansTable.id],
    }),
  })
);
