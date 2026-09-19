import type { ExternalBookingSource } from "../entity/external_booking_source";

export interface ExternalBookingSourcesRepository {
  /** Active sources only — soft-deleted rows are filtered out, which is what
   *  makes removing a calendar actually stop the reconciliation sync. */
  allFromProperty(propertyId: string): Promise<ExternalBookingSource[]>;
  /** Active source only, so a second delete of the same row surfaces as
   *  "not found" rather than succeeding twice. */
  externalBookingSourceOfId(id: string): Promise<ExternalBookingSource | null>;
  save(externalBookingSource: ExternalBookingSource): Promise<void>;
  update(externalBookingSource: ExternalBookingSource): Promise<void>;
  delete(externalBookingSource: ExternalBookingSource): Promise<void>;
}
