import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../../auth/domain/entity/user";
import type { PropertyRepository } from "../../../property_management/domain/repository/property_repository";
import { PropertyOwnershipPolicy } from "../../../property_management/domain/policy/property_ownership_policy";
import type {
  DateFilter,
  LedgerEntryRepository,
} from "../../domain/repository/ledger_entry_repository";
import type {
  PaginatedResult,
  PaginationInput,
} from "../../../core/application/dto/pagination";

type Input = {
  propertyId: string;
  pagination: PaginationInput;
  dateFilter?: DateFilter;
};

type Output = PaginatedResult<{
  id: string;
  amount: number;
  description: string | null;
  category: string;
  property_id: string;
  created_at: Date;
  updated_at: Date;
}>;

/**
 * Use case para buscar movimentações financeiras de uma propriedade específica
 *
 * R-1: previously read the ledger straight from `propertyId` without ever
 * checking ownership — any authenticated user could read any property's
 * full financial history by guessing/knowing its UUID. Now gated by
 * `PropertyOwnershipPolicy`, same as `RecordRevenueUseCase`/`RecordExpenseUseCase`.
 */
export class FindPropertyFinancialMovementsUseCase
  implements UseCase<Input, Output>
{
  constructor(
    private readonly ledgerEntryRepository: LedgerEntryRepository,
    private readonly propertyRepository: PropertyRepository
  ) {}

  async execute(input: Input, user: User): Promise<Output> {
    const property = await this.propertyRepository.propertyOfId(
      input.propertyId
    );
    PropertyOwnershipPolicy.ensureOwnership(property, user);

    const movements = await this.ledgerEntryRepository.findByPropertyId(
      input.propertyId,
      input.pagination,
      input.dateFilter
    );

    return {
      pagination: movements.pagination,
      data: movements.data.map(movement => ({
        id: movement.id,
        amount: movement.amount,
        description: movement.description,
        category: movement.category,
        property_id: movement.property_id,
        created_at: movement.created_at,
        updated_at: movement.updated_at,
      })),
    };
  }
}
