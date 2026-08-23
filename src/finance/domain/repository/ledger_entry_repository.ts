import type { LedgerEntry } from "../entity/ledger_entry";
import type {
  PaginatedResult,
  PaginationInput,
} from "../../../core/application/dto/pagination";

export type DateFilter = {
  start_date?: Date;
  end_date?: Date;
};

export interface LedgerEntryRepository {
  save(entry: LedgerEntry): Promise<void>;
  entryOfId(id: string): Promise<LedgerEntry | null>;
  propertyBalance(propertyId: string): Promise<number>;
  findByPropertyId(
    propertyId: string,
    pagination: PaginationInput,
    dateFilter?: DateFilter
  ): Promise<PaginatedResult<LedgerEntry>>;
  monthlyRevenueForProperties(
    propertyIds: string[],
    date: Date
  ): Promise<number>;
}
