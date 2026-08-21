import { and, count, desc, eq, isNull } from "drizzle-orm";
import {
  AppSetting,
  type AppSettingData,
} from "../../../domain/entity/app_setting";
import type { AppSettingRepository } from "../../../domain/repository/app_setting_repository";
import { db } from "../../../../core/infra/database/drizzle/database";
import { appSettingsTable } from "../../../../core/infra/database/drizzle/schema";
import type {
  PaginatedResult,
  PaginationInput,
} from "../../../../core/application/dto/pagination";
import { calculatePaginationMetadata } from "../../../../core/application/dto/pagination";
import { ConflictError } from "../../../../core/application/error/conflict_error";
import { isUniqueViolationError } from "../../../../core/infra/database/postgres_error";

export class AppSettingPostgresRepository implements AppSettingRepository {
  async save(setting: AppSetting): Promise<void> {
    const data: AppSettingData = {
      id: setting.id,
      key: setting.key,
      value: setting.value,
      type: setting.type,
      description: setting.description,
      created_at: setting.created_at,
      updated_at: setting.updated_at,
      deleted_at: setting.deleted_at,
    };

    try {
      const result = await db.insert(appSettingsTable).values(data).returning();

      if (!result[0]) {
        throw new Error("Failed to save app setting");
      }
    } catch (error) {
      if (isUniqueViolationError(error)) {
        throw new ConflictError("App setting key already exists");
      }
      throw error;
    }
  }

  async update(setting: AppSetting): Promise<void> {
    await db
      .update(appSettingsTable)
      .set({
        value: setting.value,
        type: setting.type,
        description: setting.description,
        updated_at: setting.updated_at,
      })
      .where(eq(appSettingsTable.id, setting.id));
  }

  async findById(id: string): Promise<AppSetting | null> {
    const result = await db
      .select()
      .from(appSettingsTable)
      .where(
        and(eq(appSettingsTable.id, id), isNull(appSettingsTable.deleted_at))
      )
      .limit(1);

    if (!result[0]) return null;
    return AppSetting.reconstitute(result[0] as AppSettingData);
  }

  async findByKey(key: string): Promise<AppSetting | null> {
    const result = await db
      .select()
      .from(appSettingsTable)
      .where(
        and(eq(appSettingsTable.key, key), isNull(appSettingsTable.deleted_at))
      )
      .limit(1);

    if (!result[0]) return null;
    return AppSetting.reconstitute(result[0] as AppSettingData);
  }

  async list(
    pagination: PaginationInput
  ): Promise<PaginatedResult<AppSetting>> {
    const whereClause = isNull(appSettingsTable.deleted_at);
    const offset = (pagination.page - 1) * pagination.limit;

    const [totalResult, rows] = await Promise.all([
      db.select({ count: count() }).from(appSettingsTable).where(whereClause),
      db
        .select()
        .from(appSettingsTable)
        .where(whereClause)
        .orderBy(desc(appSettingsTable.created_at))
        .limit(pagination.limit)
        .offset(offset),
    ]);

    const total = totalResult[0]?.count ? Number(totalResult[0].count) : 0;
    const settings = rows.map(row =>
      AppSetting.reconstitute(row as AppSettingData)
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

  async delete(setting: AppSetting): Promise<void> {
    await db
      .update(appSettingsTable)
      .set({
        deleted_at: setting.deleted_at,
        updated_at: setting.updated_at,
      })
      .where(eq(appSettingsTable.id, setting.id));
  }
}
