import { and, eq, gte, isNull, lte, ne } from "drizzle-orm";
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
    const isOccupied = await currentExecutor().query.staysTable.findFirst({
      where: and(
        isNull(staysTable.deleted_at),
        eq(staysTable.property_id, property_id),
        gte(staysTable.check_out, check_in),
        lte(staysTable.check_in, check_out),
        stay_id ? ne(staysTable.id, stay_id) : undefined
      ),
    });

    if (isOccupied) {
      throw new ConflictError("Property is occupied");
    }
  }
}
