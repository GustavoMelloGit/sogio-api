import type { User } from "../../../auth/domain/entity/user";
import type { UseCase } from "../../../core/application/use_case/use_case";
import { ResourceNotFoundError } from "../../../core/application/error/resource_not_found_error";
import type { PropertyRepository } from "../../../property_management/domain/repository/property_repository";
import { PropertyOwnershipPolicy } from "../../../property_management/domain/policy/property_ownership_policy";
import { LedgerEntry } from "../../domain/entity/ledger_entry";
import type { LedgerEntryRepository } from "../../domain/repository/ledger_entry_repository";

type Input = {
  property_id: string;
  entry_id: string;
};

type Output = void;

export class DeleteLedgerEntryUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly ledgerEntryRepository: LedgerEntryRepository,
    private readonly propertyRepository: PropertyRepository
  ) {}

  async execute(input: Input, user: User): Promise<Output> {
    const property = await this.propertyRepository.propertyOfId(
      input.property_id
    );
    PropertyOwnershipPolicy.ensureOwnership(property, user);

    const entry = await this.ledgerEntryRepository.entryOfId(input.entry_id);
    if (!entry || entry.deleted_at || entry.property_id !== input.property_id) {
      throw new ResourceNotFoundError("LedgerEntry");
    }

    const deletedEntry = LedgerEntry.reconstitute({
      id: entry.id,
      amount: entry.amount,
      description: entry.description,
      category: entry.category,
      property_id: entry.property_id,
      created_at: entry.created_at,
      updated_at: new Date(),
      deleted_at: new Date(),
    });

    await this.ledgerEntryRepository.save(deletedEntry);
  }
}
