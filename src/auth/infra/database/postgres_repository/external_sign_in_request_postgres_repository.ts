import { and, eq, gt, isNull, lt } from "drizzle-orm";
import {
  ExternalSignInRequest,
  type ExternalSignInRequestData,
} from "../../../domain/entity/external_sign_in_request";
import type { ExternalSignInRequestRepository } from "../../../domain/repository/external_sign_in_request_repository";
import type { IdentityProvider } from "../../../domain/entity/linked_identity";
import { db } from "../../../../core/infra/database/drizzle/database";
import { externalSignInRequestsTable } from "../../../../core/infra/database/drizzle/schema";

type ExternalSignInRequestRow = typeof externalSignInRequestsTable.$inferSelect;

function rowToExternalSignInRequestData(
  row: ExternalSignInRequestRow
): ExternalSignInRequestData {
  return {
    id: row.id,
    provider: row.provider as IdentityProvider,
    state_digest: row.state_digest,
    code_challenge: row.code_challenge,
    nonce_digest: row.nonce_digest,
    return_to: row.return_to ?? undefined,
    expires_at: row.expires_at,
    consumed_at: row.consumed_at ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? undefined,
  };
}

export class ExternalSignInRequestPostgresRepository
  implements ExternalSignInRequestRepository
{
  async create(input: ExternalSignInRequest): Promise<ExternalSignInRequest> {
    const result = await db
      .insert(externalSignInRequestsTable)
      .values({
        id: input.id,
        provider: input.provider,
        state_digest: input.state_digest,
        code_challenge: input.code_challenge,
        nonce_digest: input.nonce_digest,
        return_to: input.return_to,
        expires_at: input.expires_at,
        consumed_at: input.consumed_at,
        created_at: input.created_at,
        updated_at: input.updated_at,
        deleted_at: input.deleted_at,
      })
      .returning();

    const row = result[0];

    if (!row) {
      throw new Error("Failed to save external sign-in request");
    }

    return ExternalSignInRequest.reconstitute(
      rowToExternalSignInRequestData(row)
    );
  }

  async claim(stateDigest: string): Promise<ExternalSignInRequest | null> {
    const result = await db
      .update(externalSignInRequestsTable)
      .set({ consumed_at: new Date(), updated_at: new Date() })
      .where(
        and(
          eq(externalSignInRequestsTable.state_digest, stateDigest),
          isNull(externalSignInRequestsTable.consumed_at),
          gt(externalSignInRequestsTable.expires_at, new Date())
        )
      )
      .returning();

    const row = result[0];

    return row
      ? ExternalSignInRequest.reconstitute(rowToExternalSignInRequestData(row))
      : null;
  }

  async deleteExpired(before: Date): Promise<number> {
    const result = await db
      .delete(externalSignInRequestsTable)
      .where(lt(externalSignInRequestsTable.expires_at, before))
      .returning({ id: externalSignInRequestsTable.id });

    return result.length;
  }
}
