import type { User } from "../../../auth/domain/entity/user";
import { ResourceNotFoundError } from "../../../core/application/error/resource_not_found_error";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { PropertyRepository } from "../../../property_management/domain/repository/property_repository";
import {
  LedgerEntry,
  type ExpenseCategory,
} from "../../domain/entity/ledger_entry";
import type { LedgerEntryRepository } from "../../domain/repository/ledger_entry_repository";

type Input = {
  amount: number;
  description: string | null;
  category: ExpenseCategory;
  property_id: string;
};

type Output = void;

export class RecordExpenseUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly ledgerEntryRepository: LedgerEntryRepository,
    private readonly propertyRepository: PropertyRepository
  ) {}

  async execute(input: Input, user: User): Promise<Output> {
    const property = await this.propertyRepository.propertyOfId(
      input.property_id
    );

    const userOwnsProperty = property?.user_id === user.id;

    if (!property || !userOwnsProperty) {
      throw new ResourceNotFoundError("Property");
    }

    const negativeAmount = input.amount * -1;

    const ledgerEntry = LedgerEntry.newExpense({
      ...input,
      amount: negativeAmount,
    });

    await this.ledgerEntryRepository.save(ledgerEntry);
  }
}
