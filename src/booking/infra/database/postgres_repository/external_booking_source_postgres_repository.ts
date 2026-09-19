import { and, eq, isNull } from "drizzle-orm";
import { type ExternalBookingSourcesRepository } from "../../../domain/repository/external_booking_source_repository";
import { db } from "../../../../core/infra/database/drizzle/database";
import { externalBookingSources } from "../../../../core/infra/database/drizzle/schema";
import {
  ExternalBookingSource,
  type ExternalBookingSourceData,
} from "../../../domain/entity/external_booking_source";

export class ExternalBookingSourcePostgresRepository
  implements ExternalBookingSourcesRepository
{
  async allFromProperty(propertyId: string): Promise<ExternalBookingSource[]> {
    const bookingSources = await db.query.externalBookingSources.findMany({
      where: and(
        eq(externalBookingSources.property_id, propertyId),
        isNull(externalBookingSources.deleted_at)
      ),
    });

    return bookingSources.map(bookingSource =>
      ExternalBookingSource.reconstitute(bookingSource)
    );
  }

  async externalBookingSourceOfId(
    id: string
  ): Promise<ExternalBookingSource | null> {
    const bookingSource = await db.query.externalBookingSources.findFirst({
      where: and(
        eq(externalBookingSources.id, id),
        isNull(externalBookingSources.deleted_at)
      ),
    });

    if (!bookingSource) return null;
    return ExternalBookingSource.reconstitute(bookingSource);
  }

  async save(externalBookingSource: ExternalBookingSource): Promise<void> {
    const data: ExternalBookingSourceData = {
      id: externalBookingSource.id,
      property_id: externalBookingSource.property_id,
      platform_name: externalBookingSource.platform_name,
      sync_url: externalBookingSource.sync_url,
      created_at: externalBookingSource.created_at,
      updated_at: externalBookingSource.updated_at,
      deleted_at: externalBookingSource.deleted_at,
    };
    const result = await db
      .insert(externalBookingSources)
      .values(data)
      .returning();

    if (!result[0]) {
      throw new Error("Failed to save external booking source");
    }
  }

  async update(externalBookingSource: ExternalBookingSource): Promise<void> {
    await db
      .update(externalBookingSources)
      .set({
        platform_name: externalBookingSource.platform_name,
        sync_url: externalBookingSource.sync_url,
        updated_at: externalBookingSource.updated_at,
      })
      .where(eq(externalBookingSources.id, externalBookingSource.id));
  }

  async delete(externalBookingSource: ExternalBookingSource): Promise<void> {
    await db
      .update(externalBookingSources)
      .set({
        deleted_at: externalBookingSource.deleted_at,
        updated_at: externalBookingSource.updated_at,
      })
      .where(eq(externalBookingSources.id, externalBookingSource.id));
  }
}
