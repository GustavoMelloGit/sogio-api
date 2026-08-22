import { and, eq, isNull } from "drizzle-orm";
import { currentExecutor } from "../../../../core/infra/database/drizzle/transaction_context";
import { notificationPreferencesTable } from "../../../../core/infra/database/drizzle/schema";
import {
  NotificationPreference,
  notificationPreferenceSchema,
} from "../../../domain/entity/notification_preference";
import type { NotificationPreferenceRepository } from "../../../domain/repository/notification_preference_repository";

export class NotificationPreferencePostgresRepository
  implements NotificationPreferenceRepository
{
  async allOfUser(userId: string): Promise<NotificationPreference[]> {
    const rows = await currentExecutor()
      .select()
      .from(notificationPreferencesTable)
      .where(
        and(
          eq(notificationPreferencesTable.user_id, userId),
          isNull(notificationPreferencesTable.deleted_at)
        )
      );

    return rows.map(row =>
      NotificationPreference.reconstitute(
        notificationPreferenceSchema.parse(row)
      )
    );
  }

  async save(preference: NotificationPreference): Promise<void> {
    await currentExecutor()
      .insert(notificationPreferencesTable)
      .values(preference.data)
      .onConflictDoUpdate({
        target: [
          notificationPreferencesTable.user_id,
          notificationPreferencesTable.type,
          notificationPreferencesTable.channel,
        ],
        set: {
          enabled: preference.data.enabled,
          updated_at: preference.data.updated_at,
        },
      });
  }
}
