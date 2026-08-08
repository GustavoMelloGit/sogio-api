import { and, eq, isNull } from "drizzle-orm";
import {
  Consent,
  type ConsentData,
} from "../../../../domain/entity/delegated_access/consent";
import type { ConsentRepository } from "../../../../domain/repository/delegated_access/consent_repository";
import { db } from "../../../../../core/infra/database/drizzle/database";
import { consentsTable } from "../../../../../core/infra/database/drizzle/schema";

type ConsentRow = typeof consentsTable.$inferSelect;

function rowToConsentData(row: ConsentRow): ConsentData {
  return {
    id: row.id,
    user_id: row.user_id,
    app_registration_id: row.app_registration_id,
    scope: row.scope,
    granted_at: row.granted_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? undefined,
  };
}

export class ConsentPostgresRepository implements ConsentRepository {
  async create(input: Consent): Promise<Consent> {
    const result = await db
      .insert(consentsTable)
      .values({
        id: input.id,
        user_id: input.user_id,
        app_registration_id: input.app_registration_id,
        scope: input.scope,
        granted_at: input.granted_at,
        last_used_at: input.last_used_at,
        revoked_at: input.revoked_at,
        created_at: input.created_at,
        updated_at: input.updated_at,
        deleted_at: input.deleted_at,
      })
      .returning();

    const row = result[0];

    if (!row) {
      throw new Error("Failed to save consent");
    }

    return Consent.reconstitute(rowToConsentData(row));
  }

  async findById(id: string): Promise<Consent | null> {
    const row = await db.query.consentsTable.findFirst({
      where: eq(consentsTable.id, id),
    });

    return row ? Consent.reconstitute(rowToConsentData(row)) : null;
  }

  async findByUserAndApp(
    userId: string,
    appRegistrationId: string
  ): Promise<Consent | null> {
    const row = await db.query.consentsTable.findFirst({
      where: and(
        eq(consentsTable.user_id, userId),
        eq(consentsTable.app_registration_id, appRegistrationId)
      ),
    });

    return row ? Consent.reconstitute(rowToConsentData(row)) : null;
  }

  async findActiveByUser(userId: string): Promise<Consent[]> {
    const rows = await db.query.consentsTable.findMany({
      where: and(
        eq(consentsTable.user_id, userId),
        isNull(consentsTable.revoked_at)
      ),
    });

    return rows.map(row => Consent.reconstitute(rowToConsentData(row)));
  }

  async touchLastUsedAt(id: string): Promise<void> {
    await db
      .update(consentsTable)
      .set({ last_used_at: new Date(), updated_at: new Date() })
      .where(eq(consentsTable.id, id));
  }

  async revoke(id: string): Promise<void> {
    await db
      .update(consentsTable)
      .set({ revoked_at: new Date(), updated_at: new Date() })
      .where(eq(consentsTable.id, id));
  }

  async revive(id: string, scope: string, grantedAt: Date): Promise<void> {
    await db
      .update(consentsTable)
      .set({
        scope,
        granted_at: grantedAt,
        last_used_at: grantedAt,
        revoked_at: null,
        updated_at: new Date(),
      })
      .where(eq(consentsTable.id, id));
  }
}
