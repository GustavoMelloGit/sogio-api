import { and, eq, gt, isNull, lt } from "drizzle-orm";
import {
  AuthorizationRequest,
  type AuthorizationRequestData,
} from "../../../../domain/entity/delegated_access/authorization_request";
import type { AuthorizationRequestRepository } from "../../../../domain/repository/delegated_access/authorization_request_repository";
import { db } from "../../../../../core/infra/database/drizzle/database";
import { authorizationRequestsTable } from "../../../../../core/infra/database/drizzle/schema";

type AuthorizationRequestRow = typeof authorizationRequestsTable.$inferSelect;

function rowToAuthorizationRequestData(
  row: AuthorizationRequestRow
): AuthorizationRequestData {
  return {
    id: row.id,
    identifier_digest: row.identifier_digest,
    app_registration_id: row.app_registration_id,
    redirect_uri: row.redirect_uri,
    code_challenge: row.code_challenge,
    code_challenge_method: "S256",
    scope: row.scope,
    resource: row.resource,
    state: row.state ?? undefined,
    expires_at: row.expires_at,
    consumed_at: row.consumed_at ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? undefined,
  };
}

export class AuthorizationRequestPostgresRepository
  implements AuthorizationRequestRepository
{
  async create(input: AuthorizationRequest): Promise<AuthorizationRequest> {
    const result = await db
      .insert(authorizationRequestsTable)
      .values({
        id: input.id,
        identifier_digest: input.identifier_digest,
        app_registration_id: input.app_registration_id,
        redirect_uri: input.redirect_uri,
        code_challenge: input.code_challenge,
        code_challenge_method: input.code_challenge_method,
        scope: input.scope,
        resource: input.resource,
        state: input.state,
        expires_at: input.expires_at,
        consumed_at: input.consumed_at,
        created_at: input.created_at,
        updated_at: input.updated_at,
        deleted_at: input.deleted_at,
      })
      .returning();

    const row = result[0];

    if (!row) {
      throw new Error("Failed to save authorization request");
    }

    return AuthorizationRequest.reconstitute(
      rowToAuthorizationRequestData(row)
    );
  }

  async findByIdentifierDigest(
    identifierDigest: string
  ): Promise<AuthorizationRequest | null> {
    const row = await db.query.authorizationRequestsTable.findFirst({
      where: eq(authorizationRequestsTable.identifier_digest, identifierDigest),
    });

    return row
      ? AuthorizationRequest.reconstitute(rowToAuthorizationRequestData(row))
      : null;
  }

  async claim(identifierDigest: string): Promise<AuthorizationRequest | null> {
    const result = await db
      .update(authorizationRequestsTable)
      .set({ consumed_at: new Date(), updated_at: new Date() })
      .where(
        and(
          eq(authorizationRequestsTable.identifier_digest, identifierDigest),
          isNull(authorizationRequestsTable.consumed_at),
          gt(authorizationRequestsTable.expires_at, new Date())
        )
      )
      .returning();

    const row = result[0];

    return row
      ? AuthorizationRequest.reconstitute(rowToAuthorizationRequestData(row))
      : null;
  }

  async deleteExpired(before: Date): Promise<number> {
    const result = await db
      .delete(authorizationRequestsTable)
      .where(lt(authorizationRequestsTable.expires_at, before))
      .returning({ id: authorizationRequestsTable.id });

    return result.length;
  }
}
