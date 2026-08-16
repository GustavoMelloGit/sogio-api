import { and, count, eq, gte, isNull, lt } from "drizzle-orm";
import {
  PasswordResetRequest,
  type PasswordResetRequestData,
} from "../../../domain/entity/password_reset_request";
import type { PasswordResetRequestRepository } from "../../../domain/repository/password_reset_request_repository";
import { db } from "../../../../core/infra/database/drizzle/database";
import { passwordResetRequestsTable } from "../../../../core/infra/database/drizzle/schema";

type PasswordResetRequestRow = typeof passwordResetRequestsTable.$inferSelect;

function rowToPasswordResetRequestData(
  row: PasswordResetRequestRow
): PasswordResetRequestData {
  return {
    id: row.id,
    user_id: row.user_id,
    token_digest: row.token_digest,
    expires_at: row.expires_at,
    consumed_at: row.consumed_at ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? undefined,
  };
}

export class PasswordResetRequestPostgresRepository
  implements PasswordResetRequestRepository
{
  async create(input: PasswordResetRequest): Promise<PasswordResetRequest> {
    const result = await db
      .insert(passwordResetRequestsTable)
      .values({
        id: input.id,
        user_id: input.user_id,
        token_digest: input.token_digest,
        expires_at: input.expires_at,
        consumed_at: input.consumed_at,
        created_at: input.created_at,
        updated_at: input.updated_at,
        deleted_at: input.deleted_at,
      })
      .returning();

    const row = result[0];

    if (!row) {
      throw new Error("Failed to save password reset request");
    }

    return PasswordResetRequest.reconstitute(
      rowToPasswordResetRequestData(row)
    );
  }

  async claim(tokenDigest: string): Promise<PasswordResetRequest | null> {
    const result = await db
      .update(passwordResetRequestsTable)
      .set({ consumed_at: new Date(), updated_at: new Date() })
      .where(
        and(
          eq(passwordResetRequestsTable.token_digest, tokenDigest),
          isNull(passwordResetRequestsTable.consumed_at)
        )
      )
      .returning();

    const row = result[0];

    return row
      ? PasswordResetRequest.reconstitute(rowToPasswordResetRequestData(row))
      : null;
  }

  async countByUserSince(userId: string, since: Date): Promise<number> {
    const result = await db
      .select({ value: count() })
      .from(passwordResetRequestsTable)
      .where(
        and(
          eq(passwordResetRequestsTable.user_id, userId),
          gte(passwordResetRequestsTable.created_at, since)
        )
      );

    return result[0]?.value ?? 0;
  }

  async invalidatePendingByUser(userId: string): Promise<void> {
    await db
      .update(passwordResetRequestsTable)
      .set({ consumed_at: new Date(), updated_at: new Date() })
      .where(
        and(
          eq(passwordResetRequestsTable.user_id, userId),
          isNull(passwordResetRequestsTable.consumed_at)
        )
      );
  }

  async deleteOlderThan(before: Date): Promise<number> {
    const result = await db
      .delete(passwordResetRequestsTable)
      .where(lt(passwordResetRequestsTable.created_at, before))
      .returning({ id: passwordResetRequestsTable.id });

    return result.length;
  }
}
