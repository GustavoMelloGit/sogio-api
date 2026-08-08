import { and, eq, lt, notExists } from "drizzle-orm";
import {
  AppRegistration,
  type AppRegistrationData,
} from "../../../../domain/entity/delegated_access/app_registration";
import type { AppRegistrationRepository } from "../../../../domain/repository/delegated_access/app_registration_repository";
import { db } from "../../../../../core/infra/database/drizzle/database";
import {
  appRegistrationsTable,
  consentsTable,
} from "../../../../../core/infra/database/drizzle/schema";

type AppRegistrationRow = typeof appRegistrationsTable.$inferSelect;

function rowToAppRegistrationData(
  row: AppRegistrationRow
): AppRegistrationData {
  return {
    id: row.id,
    client_name: row.client_name,
    redirect_uris: row.redirect_uris,
    token_endpoint_auth_method: "none",
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? undefined,
  };
}

export class AppRegistrationPostgresRepository
  implements AppRegistrationRepository
{
  async create(input: AppRegistration): Promise<AppRegistration> {
    const result = await db
      .insert(appRegistrationsTable)
      .values({
        id: input.id,
        client_name: input.client_name,
        redirect_uris: [...input.redirect_uris],
        token_endpoint_auth_method: input.token_endpoint_auth_method,
        created_at: input.created_at,
        updated_at: input.updated_at,
        deleted_at: input.deleted_at,
      })
      .returning();

    const row = result[0];

    if (!row) {
      throw new Error("Failed to save app registration");
    }

    return AppRegistration.reconstitute(rowToAppRegistrationData(row));
  }

  async findById(id: string): Promise<AppRegistration | null> {
    const row = await db.query.appRegistrationsTable.findFirst({
      where: eq(appRegistrationsTable.id, id),
    });

    return row
      ? AppRegistration.reconstitute(rowToAppRegistrationData(row))
      : null;
  }

  async deleteUnusedRegisteredBefore(threshold: Date): Promise<number> {
    const result = await db
      .delete(appRegistrationsTable)
      .where(
        and(
          lt(appRegistrationsTable.created_at, threshold),
          notExists(
            db
              .select()
              .from(consentsTable)
              .where(
                eq(consentsTable.app_registration_id, appRegistrationsTable.id)
              )
          )
        )
      )
      .returning({ id: appRegistrationsTable.id });

    return result.length;
  }
}
