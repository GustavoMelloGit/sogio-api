import { and, eq, isNull } from "drizzle-orm";
import { currentExecutor } from "../../../../core/infra/database/drizzle/transaction_context";
import { BookingProperty } from "../../../domain/entity/booking_property";
import type { BookingPropertyRepository } from "../../../domain/repository/booking_property_repository";
import { propertiesTable } from "../../../../core/infra/database/drizzle/schema";

/**
 * Unlike `PropertyPostgresRepository`, both methods here filter
 * `deleted_at` at the source. That's safe because `booking` never writes to
 * `properties` — only `property_management` does, and only it needs the
 * unfiltered load `save()` depends on (see R-2 there).
 */
export class BookingPropertyPostgresRepository
  implements BookingPropertyRepository
{
  async allFromUser(userId: string): Promise<Array<BookingProperty>> {
    const properties = await currentExecutor().query.propertiesTable.findMany({
      where: and(
        eq(propertiesTable.user_id, userId),
        isNull(propertiesTable.deleted_at)
      ),
    });

    return properties.map(property => BookingProperty.reconstitute(property));
  }
  async propertyOfId(id: string): Promise<BookingProperty | null> {
    const property = await currentExecutor().query.propertiesTable.findFirst({
      where: and(
        eq(propertiesTable.id, id),
        isNull(propertiesTable.deleted_at)
      ),
    });

    return property ? BookingProperty.reconstitute(property) : null;
  }
}
