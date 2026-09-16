import { and, eq, isNull, lt, ne, or } from "drizzle-orm";
import { Session, type SessionData } from "../../../domain/entity/session";
import type { SessionRepository } from "../../../domain/repository/session_repository";
import { db } from "../../../../core/infra/database/drizzle/database";
import { sessionsTable } from "../../../../core/infra/database/drizzle/schema";

type SessionRow = typeof sessionsTable.$inferSelect;

function rowToSessionData(row: SessionRow): SessionData {
  return {
    id: row.id,
    user_id: row.user_id,
    secret_digest: row.secret_digest,
    expires_at: row.expires_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? undefined,
  };
}

export class SessionPostgresRepository implements SessionRepository {
  async create(session: Session): Promise<Session> {
    const result = await db
      .insert(sessionsTable)
      .values({
        id: session.id,
        user_id: session.user_id,
        secret_digest: session.secret_digest,
        expires_at: session.expires_at,
        last_used_at: session.last_used_at,
        revoked_at: session.revoked_at,
        created_at: session.created_at,
        updated_at: session.updated_at,
        deleted_at: session.deleted_at,
      })
      .returning();

    const row = result[0];

    if (!row) {
      throw new Error("Failed to save session");
    }

    return Session.reconstitute(rowToSessionData(row));
  }

  async findBySecretDigest(secretDigest: string): Promise<Session | null> {
    const row = await db.query.sessionsTable.findFirst({
      where: eq(sessionsTable.secret_digest, secretDigest),
    });

    return row ? Session.reconstitute(rowToSessionData(row)) : null;
  }

  async touch(sessionId: string, usedAt: Date): Promise<void> {
    await db
      .update(sessionsTable)
      .set({ last_used_at: usedAt, updated_at: usedAt })
      .where(eq(sessionsTable.id, sessionId));
  }

  async revokeBySecretDigest(secretDigest: string): Promise<void> {
    const now = new Date();

    await db
      .update(sessionsTable)
      .set({ revoked_at: now, updated_at: now })
      .where(
        and(
          eq(sessionsTable.secret_digest, secretDigest),
          isNull(sessionsTable.revoked_at)
        )
      );
  }

  async revoke(sessionId: string): Promise<void> {
    const now = new Date();

    await db
      .update(sessionsTable)
      .set({ revoked_at: now, updated_at: now })
      .where(
        and(eq(sessionsTable.id, sessionId), isNull(sessionsTable.revoked_at))
      );
  }

  async revokeAllForUser(
    userId: string,
    exceptSessionId?: string
  ): Promise<void> {
    const now = new Date();

    await db
      .update(sessionsTable)
      .set({ revoked_at: now, updated_at: now })
      .where(
        and(
          eq(sessionsTable.user_id, userId),
          isNull(sessionsTable.revoked_at),
          exceptSessionId ? ne(sessionsTable.id, exceptSessionId) : undefined
        )
      );
  }

  async deleteExpired(
    now: Date,
    inactivityTtlMs: number,
    revokedGraceMs: number
  ): Promise<number> {
    const deleted = await db
      .delete(sessionsTable)
      .where(
        or(
          lt(sessionsTable.expires_at, now),
          lt(
            sessionsTable.last_used_at,
            new Date(now.getTime() - inactivityTtlMs)
          ),
          lt(sessionsTable.revoked_at, new Date(now.getTime() - revokedGraceMs))
        )
      )
      .returning({ id: sessionsTable.id });

    return deleted.length;
  }
}
