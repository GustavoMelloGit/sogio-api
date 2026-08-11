import { and, eq, isNull, lt } from "drizzle-orm";
import {
  AuthorizationCode,
  type AuthorizationCodeData,
} from "../../../../domain/entity/delegated_access/authorization_code";
import type { AuthorizationCodeRepository } from "../../../../domain/repository/delegated_access/authorization_code_repository";
import { db } from "../../../../../core/infra/database/drizzle/database";
import { authorizationCodesTable } from "../../../../../core/infra/database/drizzle/schema";

type AuthorizationCodeRow = typeof authorizationCodesTable.$inferSelect;

function rowToAuthorizationCodeData(
  row: AuthorizationCodeRow
): AuthorizationCodeData {
  return {
    id: row.id,
    code_digest: row.code_digest,
    app_registration_id: row.app_registration_id,
    consent_id: row.consent_id,
    redirect_uri: row.redirect_uri,
    code_challenge: row.code_challenge,
    code_challenge_method: "S256",
    scope: row.scope,
    resource: row.resource,
    expires_at: row.expires_at,
    consumed_at: row.consumed_at ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? undefined,
  };
}

export class AuthorizationCodePostgresRepository
  implements AuthorizationCodeRepository
{
  async create(input: AuthorizationCode): Promise<AuthorizationCode> {
    const result = await db
      .insert(authorizationCodesTable)
      .values({
        id: input.id,
        code_digest: input.code_digest,
        app_registration_id: input.app_registration_id,
        consent_id: input.consent_id,
        redirect_uri: input.redirect_uri,
        code_challenge: input.code_challenge,
        code_challenge_method: input.code_challenge_method,
        scope: input.scope,
        resource: input.resource,
        expires_at: input.expires_at,
        consumed_at: input.consumed_at,
        created_at: input.created_at,
        updated_at: input.updated_at,
        deleted_at: input.deleted_at,
      })
      .returning();

    const row = result[0];

    if (!row) {
      throw new Error("Failed to save authorization code");
    }

    return AuthorizationCode.reconstitute(rowToAuthorizationCodeData(row));
  }

  async claim(codeDigest: string): Promise<AuthorizationCode | null> {
    const result = await db
      .update(authorizationCodesTable)
      .set({ consumed_at: new Date(), updated_at: new Date() })
      .where(
        and(
          eq(authorizationCodesTable.code_digest, codeDigest),
          isNull(authorizationCodesTable.consumed_at)
        )
      )
      .returning();

    const row = result[0];

    return row
      ? AuthorizationCode.reconstitute(rowToAuthorizationCodeData(row))
      : null;
  }

  async deleteExpired(before: Date): Promise<number> {
    const result = await db
      .delete(authorizationCodesTable)
      .where(lt(authorizationCodesTable.expires_at, before))
      .returning({ id: authorizationCodesTable.id });

    return result.length;
  }
}
