import { and, eq } from "drizzle-orm";
import {
  LinkedIdentity,
  type LinkedIdentityData,
  type IdentityProvider,
} from "../../../domain/entity/linked_identity";
import type { LinkedIdentityRepository } from "../../../domain/repository/linked_identity_repository";
import { currentExecutor } from "../../../../core/infra/database/drizzle/transaction_context";
import { linkedIdentitiesTable } from "../../../../core/infra/database/drizzle/schema";

type LinkedIdentityRow = typeof linkedIdentitiesTable.$inferSelect;

function rowToLinkedIdentityData(row: LinkedIdentityRow): LinkedIdentityData {
  return {
    id: row.id,
    user_id: row.user_id,
    provider: row.provider as IdentityProvider,
    subject: row.subject,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? undefined,
  };
}

export class LinkedIdentityPostgresRepository
  implements LinkedIdentityRepository
{
  async findByProviderAndSubject(
    provider: IdentityProvider,
    subject: string
  ): Promise<LinkedIdentity | null> {
    const row = await currentExecutor().query.linkedIdentitiesTable.findFirst({
      where: and(
        eq(linkedIdentitiesTable.provider, provider),
        eq(linkedIdentitiesTable.subject, subject)
      ),
    });

    return row
      ? LinkedIdentity.reconstitute(rowToLinkedIdentityData(row))
      : null;
  }

  async existsForUserAndProvider(
    userId: string,
    provider: IdentityProvider
  ): Promise<boolean> {
    const row = await currentExecutor().query.linkedIdentitiesTable.findFirst({
      where: and(
        eq(linkedIdentitiesTable.user_id, userId),
        eq(linkedIdentitiesTable.provider, provider)
      ),
    });

    return row !== undefined;
  }

  async create(identity: LinkedIdentity): Promise<LinkedIdentity> {
    const data = {
      id: identity.id,
      user_id: identity.user_id,
      provider: identity.provider,
      subject: identity.subject,
      created_at: identity.created_at,
      updated_at: identity.updated_at,
      deleted_at: identity.deleted_at,
    };

    const result = await currentExecutor()
      .insert(linkedIdentitiesTable)
      .values(data)
      .returning();

    const row = result[0];

    if (!row) {
      throw new Error("Failed to save linked identity");
    }

    return LinkedIdentity.reconstitute(rowToLinkedIdentityData(row));
  }
}
