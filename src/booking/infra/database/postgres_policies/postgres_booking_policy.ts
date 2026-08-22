import { and, between, eq, isNull, ne, or } from "drizzle-orm";
import { ConflictError } from "../../../../core/application/error/conflict_error";
import type { BookingPolicy } from "../../../domain/policy/booking_policy";
import { currentExecutor } from "../../../../core/infra/database/drizzle/transaction_context";
import { staysTable } from "../../../../core/infra/database/drizzle/schema";

export class PostgresBookingPolicy implements BookingPolicy {
  constructor() {}

  async isBookingAllowed(
    property_id: string,
    check_in: Date,
    check_out: Date,
    stay_id?: string
  ): Promise<void> {
    /**
     * Uma propriedade está ocupada se:
     * - O check-in estiver entre o check-in e check-out de uma estadia
     * - O check-out estiver entre o check-in e check-out de uma estadia
     */
    const isOccupied = await currentExecutor().query.staysTable.findFirst({
      where: and(
        isNull(staysTable.deleted_at),
        eq(staysTable.property_id, property_id),
        or(
          between(staysTable.check_in, check_in, check_out),
          between(staysTable.check_out, check_in, check_out)
        ),
        stay_id ? ne(staysTable.id, stay_id) : undefined
      ),
    });

    if (isOccupied) {
      throw new ConflictError("Property is occupied");
    }
  }
}
