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
  /**
   * Última troca de senha. Serve de corte para o JWT de sessão antigo, que
   * nenhuma revogação alcança por ser stateless: um token emitido antes disto
   * não vale mais. Some junto com a janela de compatibilidade, a menos que
   * vire dado útil por si.
   */
  password_changed_at: timestamp({ withTimezone: true, mode: "date" }),
});

export const usersRelations = relations(usersTable, ({ many }) => ({
  properties: many(propertiesTable),
}));

/**
 * Sessão do app: o usuário autenticado diretamente no front, em oposição a
 * `issued_credentials`, que representa um aplicativo agindo em nome dele.
 *
 * Guarda o digest do segredo, nunca o segredo (E10) — mesmo padrão de
 * `password_reset_requests` e das credenciais OAuth. `onDelete: "cascade"` é
 * load-bearing para o purge de dados do usuário (LGPD).
 *
 * `expires_at` é a vida absoluta e `last_used_at` alimenta a expiração por
 * inatividade: as duas nascem com a tabela, em vez de virar faxina posterior
 * (E9).
 */
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
