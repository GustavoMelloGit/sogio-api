import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  sum,
} from "drizzle-orm";
import {
  LedgerEntry,
  type LedgerEntryData,
} from "../../../domain/entity/ledger_entry";
import type {
  DateFilter,
  LedgerEntryRepository,
} from "../../../domain/repository/ledger_entry_repository";
import { db } from "../../../../core/infra/database/drizzle/database";
import { currentExecutor } from "../../../../core/infra/database/drizzle/transaction_context";
import { ledgerEntriesTable } from "../../../../core/infra/database/drizzle/schema";
import type {
  PaginatedResult,
  PaginationInput,
} from "../../../../core/application/dto/pagination";
import { calculatePaginationMetadata } from "../../../../core/application/dto/pagination";

export class LedgerEntryPostgresRepository implements LedgerEntryRepository {
  /**
   * Writes through `currentExecutor()` (DA-13): `RevertRevenueOnStayCancel`
   * calls this once per stay `DeletePropertyUseCase` cancels in cascade, and
   * every reversal needs to land in the same transaction as the
   * cancellations and the property's soft delete. Resolves to plain `db`
   * outside `TransactionRunner.run`, unchanged from before.
   */
  async save(entry: LedgerEntry): Promise<void> {
    const data: LedgerEntryData = {
      id: entry.id,
      amount: entry.amount,
      category: entry.category,
      property_id: entry.property_id,
      description: entry.description,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      deleted_at: entry.deleted_at,
    };

    const result = await currentExecutor()
      .insert(ledgerEntriesTable)
      .values(data)
      .returning();

    if (!result[0]) {
      throw new Error("Failed to save ledger entry");
    }
  }

  async propertyBalance(propertyId: string): Promise<number> {
    const result = await db
      .select({ total: sum(ledgerEntriesTable.amount) })
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, propertyId));

    const total = result[0]?.total;
    return total ? Number(total) : 0;
  }

  async monthlyRevenueForProperties(
    propertyIds: string[],
    date: Date
  ): Promise<number> {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);

    const result = await db
      .select({ total: sum(ledgerEntriesTable.amount) })
      .from(ledgerEntriesTable)
      .where(
        and(
          inArray(ledgerEntriesTable.property_id, propertyIds),
          gt(ledgerEntriesTable.amount, 0),
          gte(ledgerEntriesTable.created_at, start),
          lte(ledgerEntriesTable.created_at, end),
          isNull(ledgerEntriesTable.deleted_at)
        )
      );

    const total = result[0]?.total;
    return total ? Number(total) : 0;
  }

  async findByPropertyId(
    propertyId: string,
    pagination: PaginationInput,
    dateFilter?: DateFilter
  ): Promise<PaginatedResult<LedgerEntry>> {
    const whereClause = and(
      eq(ledgerEntriesTable.property_id, propertyId),
      dateFilter?.start_date
        ? gte(ledgerEntriesTable.created_at, dateFilter.start_date)
        : undefined,
      dateFilter?.end_date
        ? lte(ledgerEntriesTable.created_at, dateFilter.end_date)
        : undefined
    );
    const offset = (pagination.page - 1) * pagination.limit;

    const [totalResult, entries] = await Promise.all([
      db.select({ count: count() }).from(ledgerEntriesTable).where(whereClause),
      db
        .select()
        .from(ledgerEntriesTable)
        .where(whereClause)
        .orderBy(desc(ledgerEntriesTable.created_at))
        .limit(pagination.limit)
        .offset(offset),
    ]);

    const total = totalResult[0]?.count ? Number(totalResult[0].count) : 0;

    const ledgerEntries = entries.map(entry => LedgerEntry.reconstitute(entry));

    return {
      data: ledgerEntries,
      pagination: calculatePaginationMetadata(
        pagination.page,
        pagination.limit,
        total
      ),
    };
  }
}
