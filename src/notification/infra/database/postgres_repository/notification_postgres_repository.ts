import { and, asc, count, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import { db } from "../../../../core/infra/database/drizzle/database";
import { currentExecutor } from "../../../../core/infra/database/drizzle/transaction_context";
import { NotificationInboxPolicy } from "../../../domain/policy/notification_inbox_policy";
import {
  notificationsTable,
  usersTable,
} from "../../../../core/infra/database/drizzle/schema";
import {
  Notification,
  notificationSchema,
} from "../../../domain/entity/notification";
import type {
  ClaimedNotification,
  NotificationInbox,
  NotificationRepository,
} from "../../../domain/repository/notification_repository";
import {
  calculatePaginationMetadata,
  type PaginationInput,
} from "../../../../core/application/dto/pagination";
import {
  DEFAULT_LOCALE,
  DEFAULT_TIME_ZONE,
  isSupportedLocale,
  isSupportedTimeZone,
} from "../../../../core/domain/locale/locale";

const CLAIM_LEASE_MS = 5 * 60 * 1000;

export class NotificationPostgresRepository implements NotificationRepository {
  async save(notification: Notification): Promise<void> {
    const data = notification.data;

    await currentExecutor()
      .insert(notificationsTable)
      .values(data)
      .onConflictDoUpdate({
        target: notificationsTable.id,
        set: {
          status: data.status,
          attempts: data.attempts,
          next_attempt_at: data.next_attempt_at,
          sent_at: data.sent_at,
          read_at: data.read_at,
          last_error: data.last_error,
          updated_at: data.updated_at,
        },
      });
  }

  async saveMany(notifications: Notification[]): Promise<void> {
    if (notifications.length === 0) {
      return;
    }

    await currentExecutor()
      .insert(notificationsTable)
      .values(notifications.map(notification => notification.data));
  }

  #inboxScope(userId: string) {
    return and(
      eq(notificationsTable.user_id, userId),
      eq(notificationsTable.status, NotificationInboxPolicy.DELIVERED_STATUS),
      inArray(
        notificationsTable.type,
        NotificationInboxPolicy.RENDERABLE_TYPES
      ),
      isNull(notificationsTable.deleted_at)
    );
  }

  async claimDue(limit: number, now: Date): Promise<ClaimedNotification[]> {
    return db.transaction(async tx => {
      const due = await tx
        .select({ id: notificationsTable.id })
        .from(notificationsTable)
        .where(
          and(
            eq(
              notificationsTable.status,
              NotificationInboxPolicy.PENDING_DELIVERY_STATUS
            ),
            lte(notificationsTable.next_attempt_at, now),
            isNull(notificationsTable.deleted_at)
          )
        )
        .orderBy(asc(notificationsTable.next_attempt_at))
        .limit(limit)
        .for("update", { skipLocked: true });

      const ids = due.map(row => row.id);

      if (ids.length === 0) {
        return [];
      }

      await tx
        .update(notificationsTable)
        .set({ next_attempt_at: new Date(now.getTime() + CLAIM_LEASE_MS) })
        .where(inArray(notificationsTable.id, ids));

      const rows = await tx
        .select({
          notification: notificationsTable,
          user_id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
          locale: usersTable.locale,
          time_zone: usersTable.time_zone,
        })
        .from(notificationsTable)
        .innerJoin(usersTable, eq(usersTable.id, notificationsTable.user_id))
        .where(inArray(notificationsTable.id, ids));

      return rows.map(row => ({
        notification: Notification.reconstitute(
          notificationSchema.parse(row.notification)
        ),
        recipient: {
          user_id: row.user_id,
          name: row.name,
          email: row.email,
          locale: isSupportedLocale(row.locale) ? row.locale : DEFAULT_LOCALE,
          time_zone: isSupportedTimeZone(row.time_zone)
            ? row.time_zone
            : DEFAULT_TIME_ZONE,
        },
      }));
    });
  }

  async notificationOfId(id: string): Promise<Notification | null> {
    const row = await currentExecutor().query.notificationsTable.findFirst({
      where: and(
        eq(notificationsTable.id, id),
        isNull(notificationsTable.deleted_at)
      ),
    });

    return row
      ? Notification.reconstitute(notificationSchema.parse(row))
      : null;
  }

  async markInboxReadOfUser(userId: string): Promise<number> {
    const now = new Date();

    const marked = await currentExecutor()
      .update(notificationsTable)
      .set({ read_at: now, updated_at: now })
      .where(and(this.#inboxScope(userId), isNull(notificationsTable.read_at)))
      .returning({ id: notificationsTable.id });

    return marked.length;
  }

  async inboxOfUser(
    userId: string,
    pagination: PaginationInput
  ): Promise<NotificationInbox> {
    const predicate = this.#inboxScope(userId);

    const [rows, totalResult, unreadResult] = await Promise.all([
      currentExecutor()
        .select()
        .from(notificationsTable)
        .where(predicate)
        .orderBy(
          desc(notificationsTable.created_at),
          desc(notificationsTable.id)
        )
        .limit(pagination.limit)
        .offset((pagination.page - 1) * pagination.limit),
      currentExecutor()
        .select({ value: count() })
        .from(notificationsTable)
        .where(predicate),
      currentExecutor()
        .select({ value: count() })
        .from(notificationsTable)
        .where(and(predicate, isNull(notificationsTable.read_at))),
    ]);

    return {
      data: rows.map(row =>
        Notification.reconstitute(notificationSchema.parse(row))
      ),
      pagination: calculatePaginationMetadata(
        pagination.page,
        pagination.limit,
        totalResult[0]?.value ?? 0
      ),
      unread_count: unreadResult[0]?.value ?? 0,
    };
  }
}
