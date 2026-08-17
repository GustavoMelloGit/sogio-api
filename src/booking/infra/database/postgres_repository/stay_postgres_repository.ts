import { and, count, eq, gt, gte, inArray, isNull, lte } from "drizzle-orm";
import { Stay } from "../../../domain/entity/stay";
import type {
  AllFromPropertyFilters,
  DashboardStatsResult,
  StayRepository,
  StayWithTenant,
} from "../../../domain/repository/stay_repository";
import { db } from "../../../../core/infra/database/drizzle/database";
import { currentExecutor } from "../../../../core/infra/database/drizzle/transaction_context";
import {
  staysTable,
  tenantsTable,
} from "../../../../core/infra/database/drizzle/schema";
import { Tenant } from "../../../domain/entity/tenant";
import {
  calculatePaginationMetadata,
  type PaginatedResult,
  type PaginationInput,
} from "../../../../core/application/dto/pagination";

export class StayPostgresRepository implements StayRepository {
  /**
   * Writes through `currentExecutor()` (DA-13), same as `saveStay` below —
   * `DeletePropertyUseCase`'s cascade calls this to decide insert vs update
   * for every stay it cancels, inside a single transaction. Resolves to
   * plain `db` outside `TransactionRunner.run`, unchanged from before.
   */
  async stayOfId(id: string): Promise<Stay | null> {
    const stay = await currentExecutor().query.staysTable.findFirst({
      where: and(eq(staysTable.id, id), isNull(staysTable.deleted_at)),
      with: {
        tenant: true,
      },
    });

    if (!stay) {
      return null;
    }

    return Stay.reconstitute(stay);
  }

  async saveStay(input: Stay): Promise<void> {
    const stayAlreadyExists = await this.stayOfId(input.id);
    if (stayAlreadyExists) {
      await this.#updateStay(input);
    } else {
      await this.#createStay(input);
    }
  }

  async #createStay(stay: Stay): Promise<Stay> {
    const result = await currentExecutor()
      .insert(staysTable)
      .values(stay.data)
      .returning();

    if (!result[0]) throw new Error("Failed to create stay");

    return Stay.reconstitute(result[0]);
  }

  async #updateStay(stay: Stay): Promise<Stay> {
    const result = await currentExecutor()
      .update(staysTable)
      .set(stay.data)
      .where(eq(staysTable.id, stay.id))
      .returning();

    if (!result[0]) throw new Error("Failed to update stay");

    return Stay.reconstitute(result[0]);
  }

  /**
   * Reads through `currentExecutor()` (DA-13): called by
   * `DeletePropertyUseCase`'s cascade inside its transaction, and a plain
   * `db.query` there would open a second pool connection while the first is
   * still held open by the transaction — with `max: 10` and no
   * `connectionTimeoutMillis`, ten concurrent deletions deadlock the pool
   * permanently. Resolves to plain `db` outside `TransactionRunner.run`,
   * unchanged from before.
   */
  async allFutureFromProperty(propertyId: string): Promise<StayWithTenant[]> {
    const stays = await currentExecutor().query.staysTable.findMany({
      where: and(
        eq(staysTable.property_id, propertyId),
        gte(staysTable.check_out, new Date()),
        isNull(staysTable.deleted_at)
      ),
      with: {
        tenant: true,
      },
      orderBy: (staysTable, { asc }) => [asc(staysTable.check_in)],
    });

    return stays.map(stay => ({
      stay: Stay.reconstitute(stay),
      tenant: Tenant.reconstitute(stay.tenant),
    }));
  }

  async allFromProperty(
    propertyId: string,
    pagination: PaginationInput,
    filters?: AllFromPropertyFilters
  ): Promise<PaginatedResult<StayWithTenant>> {
    const whereClause = and(
      eq(staysTable.property_id, propertyId),
      isNull(staysTable.deleted_at),
      filters?.from ? gte(staysTable.check_out, filters.from) : undefined,
      filters?.to ? lte(staysTable.check_in, filters.to) : undefined
    );

    const [totalResult, stays] = await Promise.all([
      db.select({ count: count() }).from(staysTable).where(whereClause),
      db.query.staysTable.findMany({
        where: whereClause,
        with: {
          tenant: true,
        },
        orderBy: (staysTable, { asc }) => [asc(staysTable.check_in)],
        limit: pagination.limit,
        offset: (pagination.page - 1) * pagination.limit,
      }),
    ]);

    const total = totalResult[0]?.count ? Number(totalResult[0].count) : 0;

    return {
      data: stays.map(stay => ({
        stay: Stay.reconstitute(stay),
        tenant: Tenant.reconstitute(stay.tenant),
      })),
      pagination: calculatePaginationMetadata(
        pagination.page,
        pagination.limit,
        total
      ),
    };
  }

  async dashboardStats(
    propertyIds: string[],
    date: Date
  ): Promise<DashboardStatsResult> {
    const startOfDay = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    );
    const sevenDaysLater = new Date(startOfDay);
    sevenDaysLater.setUTCDate(sevenDaysLater.getUTCDate() + 7);

    const baseWhere = and(
      inArray(staysTable.property_id, propertyIds),
      isNull(staysTable.deleted_at)
    );

    const [activeResult, upcomingCheckInsResult, upcomingStays] =
      await Promise.all([
        db
          .select({ count: count() })
          .from(staysTable)
          .where(
            and(
              baseWhere,
              lte(staysTable.check_in, startOfDay),
              gte(staysTable.check_out, startOfDay)
            )
          ),
        db
          .select({ count: count() })
          .from(staysTable)
          .where(
            and(
              baseWhere,
              gt(staysTable.check_in, startOfDay),
              lte(staysTable.check_in, sevenDaysLater)
            )
          ),
        db.query.staysTable.findMany({
          where: and(baseWhere, gt(staysTable.check_in, startOfDay)),
          with: {
            tenant: true,
            property: true,
          },
          orderBy: (staysTable, { asc }) => [asc(staysTable.check_in)],
          limit: 5,
        }),
      ]);

    return {
      active_stays: activeResult[0]?.count ? Number(activeResult[0].count) : 0,
      upcoming_check_ins: upcomingCheckInsResult[0]?.count
        ? Number(upcomingCheckInsResult[0].count)
        : 0,
      upcoming_stays: upcomingStays.map(stay => ({
        id: stay.id,
        property_id: stay.property_id,
        property_name: stay.property.name,
        check_in: stay.check_in,
        tenant: { name: stay.tenant.name },
      })),
    };
  }

  async tenantWithPhone(phone: string): Promise<Tenant | null> {
    const tenant = await db.query.tenantsTable.findFirst({
      where: eq(tenantsTable.phone, phone),
    });

    if (!tenant) {
      return null;
    }

    return Tenant.reconstitute(tenant);
  }
}
