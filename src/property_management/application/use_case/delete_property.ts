import { ConflictError } from "../../../core/application/error/conflict_error";
import type { TransactionRunner } from "../../../core/application/transaction/transaction_runner";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../../auth/domain/entity/user";
import type { PropertyRepository } from "../../domain/repository/property_repository";
import type { PropertyOccupancy } from "../../domain/service/property_occupancy";
import { PropertyOwnershipPolicy } from "../../domain/policy/property_ownership_policy";

type Input = {
  property_id: string;
};

type Output = {
  canceled_stays: number;
};

function ensureNoStayInProgress(inProgressCount: number): void {
  if (inProgressCount > 0) {
    throw new ConflictError(
      "This property has a guest checked in right now. You can delete it once the current stay ends."
    );
  }
}

/**
 * Soft-deletes a property and cancels its future stays in cascade (DA-1,
 * DA-4-R, §8.2). `LedgerEntry`, `PropertySetting` and
 * `ExternalBookingSource` are untouched — they simply stop being served
 * once their filters see `deleted_at` (DA-5, DA-6, DA-7).
 *
 * Ordering is load-bearing in two ways:
 *
 * - Ownership (404) is checked before anything else, so a stranger can
 *   never cancel someone else's reservations by guessing a property UUID,
 *   and the response never confirms to a non-owner that a property both
 *   exists and has a guest checked in (404-before-409, DA-8, security
 *   review requirement).
 * - The occupancy check and the cascade run inside the same transaction as
 *   the soft delete (DA-13): if a guest turns out to be checked in right
 *   now — including the race where a future stay starts mid-cascade — the
 *   whole operation rolls back with no partial cancellation and no
 *   estranged property.
 */
export class DeletePropertyUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly propertyRepository: PropertyRepository,
    private readonly propertyOccupancy: PropertyOccupancy,
    private readonly transactionRunner: TransactionRunner
  ) {}

  async execute(input: Input, user: User): Promise<Output> {
    const property = await this.propertyRepository.propertyOfId(
      input.property_id
    );
    const ownedProperty = PropertyOwnershipPolicy.ensureOwnership(
      property,
      user
    );

    const canceledStays = await this.transactionRunner.run(async () => {
      const canceled = await this.propertyOccupancy.releaseFutureOccupancy(
        ownedProperty.id,
        ensureNoStayInProgress
      );

      ownedProperty.softDelete();
      await this.propertyRepository.save(ownedProperty);

      return canceled;
    });

    return { canceled_stays: canceledStays };
  }
}
