import { and, eq, isNull } from "drizzle-orm";
import {
  IssuedCredential,
  type IssuedCredentialData,
} from "../../../../domain/entity/delegated_access/issued_credential";
import type { IssuedCredentialRepository } from "../../../../domain/repository/delegated_access/issued_credential_repository";
import { db } from "../../../../../core/infra/database/drizzle/database";
import { issuedCredentialsTable } from "../../../../../core/infra/database/drizzle/schema";

type IssuedCredentialRow = typeof issuedCredentialsTable.$inferSelect;

function rowToIssuedCredentialData(
  row: IssuedCredentialRow
): IssuedCredentialData {
  return {
    id: row.id,
    consent_id: row.consent_id,
    family_id: row.family_id,
    access_token_digest: row.access_token_digest,
    access_token_expires_at: row.access_token_expires_at,
    refresh_token_digest: row.refresh_token_digest,
    refresh_token_expires_at: row.refresh_token_expires_at,
    resource: row.resource,
    rotated_at: row.rotated_at ?? undefined,
    successor_id: row.successor_id ?? undefined,
    revoked_at: row.revoked_at ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? undefined,
  };
}

class RotationClaimFailed extends Error {}

export class IssuedCredentialPostgresRepository
  implements IssuedCredentialRepository
{
  async issue(input: IssuedCredential): Promise<IssuedCredential> {
    const result = await db
      .insert(issuedCredentialsTable)
      .values({
        id: input.id,
        consent_id: input.consent_id,
        family_id: input.family_id,
        access_token_digest: input.access_token_digest,
        access_token_expires_at: input.access_token_expires_at,
        refresh_token_digest: input.refresh_token_digest,
        refresh_token_expires_at: input.refresh_token_expires_at,
        resource: input.resource,
        rotated_at: input.rotated_at,
        successor_id: input.successor_id,
        revoked_at: input.revoked_at,
        created_at: input.created_at,
        updated_at: input.updated_at,
        deleted_at: input.deleted_at,
      })
      .returning();

    const row = result[0];

    if (!row) {
      throw new Error("Failed to save issued credential");
    }

    return IssuedCredential.reconstitute(rowToIssuedCredentialData(row));
  }

  async findByAccessTokenDigest(
    digest: string
  ): Promise<IssuedCredential | null> {
    const row = await db.query.issuedCredentialsTable.findFirst({
      where: eq(issuedCredentialsTable.access_token_digest, digest),
    });

    return row
      ? IssuedCredential.reconstitute(rowToIssuedCredentialData(row))
      : null;
  }

  async findByRefreshTokenDigest(
    digest: string
  ): Promise<IssuedCredential | null> {
    const row = await db.query.issuedCredentialsTable.findFirst({
      where: eq(issuedCredentialsTable.refresh_token_digest, digest),
    });

    return row
      ? IssuedCredential.reconstitute(rowToIssuedCredentialData(row))
      : null;
  }

  async rotateRefreshToken(
    currentRefreshTokenDigest: string,
    successor: IssuedCredential
  ): Promise<IssuedCredential | null> {
    try {
      return await db.transaction(async tx => {
        const inserted = await tx
          .insert(issuedCredentialsTable)
          .values({
            id: successor.id,
            consent_id: successor.consent_id,
            family_id: successor.family_id,
            access_token_digest: successor.access_token_digest,
            access_token_expires_at: successor.access_token_expires_at,
            refresh_token_digest: successor.refresh_token_digest,
            refresh_token_expires_at: successor.refresh_token_expires_at,
            resource: successor.resource,
            created_at: successor.created_at,
            updated_at: successor.updated_at,
          })
          .returning();

        const successorRow = inserted[0];

        if (!successorRow) {
          throw new Error("Failed to save issued credential");
        }

        const claimed = await tx
          .update(issuedCredentialsTable)
          .set({
            rotated_at: new Date(),
            successor_id: successorRow.id,
            updated_at: new Date(),
          })
          .where(
            and(
              eq(
                issuedCredentialsTable.refresh_token_digest,
                currentRefreshTokenDigest
              ),
              isNull(issuedCredentialsTable.rotated_at),
              isNull(issuedCredentialsTable.revoked_at)
            )
          )
          .returning();

        if (!claimed[0]) {
          throw new RotationClaimFailed();
        }

        return IssuedCredential.reconstitute(
          rowToIssuedCredentialData(successorRow)
        );
      });
    } catch (error) {
      if (error instanceof RotationClaimFailed) {
        return null;
      }
      throw error;
    }
  }

  async findByFamily(familyId: string): Promise<IssuedCredential[]> {
    const rows = await db.query.issuedCredentialsTable.findMany({
      where: eq(issuedCredentialsTable.family_id, familyId),
    });

    return rows.map(row =>
      IssuedCredential.reconstitute(rowToIssuedCredentialData(row))
    );
  }

  async revokeFamily(familyId: string): Promise<void> {
    await db
      .update(issuedCredentialsTable)
      .set({ revoked_at: new Date(), updated_at: new Date() })
      .where(
        and(
          eq(issuedCredentialsTable.family_id, familyId),
          isNull(issuedCredentialsTable.revoked_at)
        )
      );
  }

  async revokeAllByConsent(consentId: string): Promise<void> {
    await db
      .update(issuedCredentialsTable)
      .set({ revoked_at: new Date(), updated_at: new Date() })
      .where(
        and(
          eq(issuedCredentialsTable.consent_id, consentId),
          isNull(issuedCredentialsTable.revoked_at)
        )
      );
  }
}
