import { count, desc, eq } from "drizzle-orm";
import {
  SubscriptionHistoryEntry,
  type SubscriptionHistoryEntryData,
  type SubscriptionHistoryEntryType,
} from "../../../domain/entity/subscription_history_entry";
import type { SubscriptionStatus } from "../../../domain/entity/subscription";
import type {
  SubscriptionHistoryEntryWithPlan,
  SubscriptionHistoryRepository,
} from "../../../domain/repository/subscription_history_repository";
import { db } from "../../../../core/infra/database/drizzle/database";
import { subscriptionHistoryEntriesTable } from "../../../../core/infra/database/drizzle/schema";
import type {
  PaginatedResult,
  PaginationInput,
} from "../../../../core/application/dto/pagination";
import { calculatePaginationMetadata } from "../../../../core/application/dto/pagination";

export class SubscriptionHistoryPostgresRepository
  implements SubscriptionHistoryRepository
{
  async append(entry: SubscriptionHistoryEntry): Promise<void> {
    const data: SubscriptionHistoryEntryData = {
      id: entry.id,
      subscription_id: entry.subscription_id,
      user_id: entry.user_id,
      plan_id: entry.plan_id,
      type: entry.type,
      resulting_status: entry.resulting_status,
      occurred_at: entry.occurred_at,
      access_until: entry.access_until,
      reason: entry.reason,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      deleted_at: entry.deleted_at,
    };

    await db.insert(subscriptionHistoryEntriesTable).values(data);
  }

  async historyOfUser(
    user_id: string,
    pagination: PaginationInput
  ): Promise<PaginatedResult<SubscriptionHistoryEntryWithPlan>> {
    const whereClause = eq(subscriptionHistoryEntriesTable.user_id, user_id);
    const offset = (pagination.page - 1) * pagination.limit;

    const [totalResult, rows] = await Promise.all([
      db
        .select({ count: count() })
        .from(subscriptionHistoryEntriesTable)
        .where(whereClause),
      db.query.subscriptionHistoryEntriesTable.findMany({
        where: whereClause,
        with: { plan: true },
        orderBy: [
          desc(subscriptionHistoryEntriesTable.occurred_at),
          desc(subscriptionHistoryEntriesTable.created_at),
          desc(subscriptionHistoryEntriesTable.id),
        ],
        limit: pagination.limit,
        offset,
      }),
    ]);

    const total = totalResult[0]?.count ? Number(totalResult[0].count) : 0;

    const data = rows.map(row => ({
      entry: SubscriptionHistoryEntry.reconstitute({
        ...row,
        type: row.type as SubscriptionHistoryEntryType,
        resulting_status: row.resulting_status as SubscriptionStatus,
      }),
      plan_code: row.plan.code,
      plan_name: row.plan.name,
    }));

    return {
      data,
      pagination: calculatePaginationMetadata(
        pagination.page,
        pagination.limit,
        total
      ),
    };
  }
}
