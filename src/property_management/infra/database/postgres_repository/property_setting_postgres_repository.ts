import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import {
  PropertySetting,
  type PropertySettingData,
} from "../../../domain/entity/property_setting";
import type { PropertySettingRepository } from "../../../domain/repository/property_setting_repository";
import { db } from "../../../../core/infra/database/drizzle/database";
import { propertySettingsTable } from "../../../../core/infra/database/drizzle/schema";
import type {
  PaginatedResult,
  PaginationInput,
} from "../../../../core/application/dto/pagination";
import { calculatePaginationMetadata } from "../../../../core/application/dto/pagination";
import { ConflictError } from "../../../../core/application/error/conflict_error";

export class PropertySettingPostgresRepository
  implements PropertySettingRepository
{
  /**
   * Locks the property (via a session-scoped Postgres advisory lock keyed by
   * `property_id`) before counting active settings and inserting, so the
   * `maxActiveSettings` check can't race with a concurrent create for the
   * same property (TOCTOU). The lock is released automatically at the end of
   * the transaction.
   */
  async save(
    setting: PropertySetting,
    maxActiveSettings: number
  ): Promise<void> {
    const data: PropertySettingData = {
      id: setting.id,
      property_id: setting.property_id,
      key: setting.key,
      value: setting.value,
      type: setting.type,
      description: setting.description,
      created_at: setting.created_at,
      updated_at: setting.updated_at,
      deleted_at: setting.deleted_at,
    };

    await db.transaction(async tx => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${setting.property_id}))`
      );

      const activeCountResult = await tx
        .select({ count: count() })
        .from(propertySettingsTable)
        .where(
          and(
            eq(propertySettingsTable.property_id, setting.property_id),
            isNull(propertySettingsTable.deleted_at)
          )
        );

      const activeCount = activeCountResult[0]?.count
        ? Number(activeCountResult[0].count)
        : 0;

      if (activeCount >= maxActiveSettings) {
        throw new ConflictError(
          `Property has reached the maximum of ${maxActiveSettings} active settings`
        );
      }

      try {
        const result = await tx
          .insert(propertySettingsTable)
          .values(data)
          .returning();

        if (!result[0]) {
          throw new Error("Failed to save property setting");
        }
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error as { code: string }).code === "23505"
        ) {
          throw new ConflictError("Property setting key already exists");
        }
        throw error;
      }
    });
  }

  async update(setting: PropertySetting): Promise<void> {
    await db
      .update(propertySettingsTable)
      .set({
        value: setting.value,
        type: setting.type,
        description: setting.description,
        updated_at: setting.updated_at,
      })
      .where(eq(propertySettingsTable.id, setting.id));
  }

  async findById(id: string): Promise<PropertySetting | null> {
    const result = await db
      .select()
      .from(propertySettingsTable)
      .where(
        and(
          eq(propertySettingsTable.id, id),
          isNull(propertySettingsTable.deleted_at)
        )
      )
      .limit(1);

    if (!result[0]) return null;
    return PropertySetting.reconstitute(result[0] as PropertySettingData);
  }

  async findByKey(
    key: string,
    propertyId: string
  ): Promise<PropertySetting | null> {
    const result = await db
      .select()
      .from(propertySettingsTable)
      .where(
        and(
          eq(propertySettingsTable.key, key),
          eq(propertySettingsTable.property_id, propertyId),
          isNull(propertySettingsTable.deleted_at)
        )
      )
      .limit(1);

    if (!result[0]) return null;
    return PropertySetting.reconstitute(result[0] as PropertySettingData);
  }

  async list(
    propertyId: string,
    pagination: PaginationInput
  ): Promise<PaginatedResult<PropertySetting>> {
    const whereClause = and(
      eq(propertySettingsTable.property_id, propertyId),
      isNull(propertySettingsTable.deleted_at)
    );
    const offset = (pagination.page - 1) * pagination.limit;

    const [totalResult, rows] = await Promise.all([
      db
        .select({ count: count() })
        .from(propertySettingsTable)
        .where(whereClause),
      db
        .select()
        .from(propertySettingsTable)
        .where(whereClause)
        .orderBy(desc(propertySettingsTable.created_at))
        .limit(pagination.limit)
        .offset(offset),
    ]);

    const total = totalResult[0]?.count ? Number(totalResult[0].count) : 0;
    const settings = rows.map(row =>
      PropertySetting.reconstitute(row as PropertySettingData)
    );

    return {
      data: settings,
      pagination: calculatePaginationMetadata(
        pagination.page,
        pagination.limit,
        total
      ),
    };
  }

  async delete(setting: PropertySetting): Promise<void> {
    await db
      .update(propertySettingsTable)
      .set({
        value: setting.value,
        description: setting.description,
        deleted_at: setting.deleted_at,
        updated_at: setting.updated_at,
      })
      .where(eq(propertySettingsTable.id, setting.id));
  }
}
