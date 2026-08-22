import { pgTable, varchar } from "drizzle-orm/pg-core";
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
});

export const usersRelations = relations(usersTable, ({ many }) => ({
  properties: many(propertiesTable),
}));
