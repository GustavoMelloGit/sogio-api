import { ConflictError } from "../../../core/application/error/conflict_error";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../../auth/domain/entity/user";
import type { PropertyRepository } from "../../domain/repository/property_repository";
import type { PropertyOccupancy } from "../../domain/service/property_occupancy";
import { PropertyOwnershipPolicy } from "../../domain/policy/property_ownership_policy";

type Input = {
  property_id: string;
};

type Output = void;

/**
 * Soft-deletes a property (DA-1, DA-8). No cascade: stays, LedgerEntry,
 * PropertySetting and ExternalBookingSource are untouched — they simply stop
 * being served once their filters see `deleted_at` (DA-5, DA-6, DA-7).
 *
 * Ordering is load-bearing: ownership (404) is checked before occupancy
 * (409), so the response never confirms to a non-owner that a property both
 * exists and has scheduled guests (DA-8, security review requirement).
 */
export class DeletePropertyUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly propertyRepository: PropertyRepository,
    private readonly propertyOccupancy: PropertyOccupancy
  ) {}

  async execute(input: Input, user: User): Promise<Output> {
    const property = await this.propertyRepository.propertyOfId(
      input.property_id
    );
    const ownedProperty = PropertyOwnershipPolicy.ensureOwnership(
      property,
      user
    );

    const hasPendingStays = await this.propertyOccupancy.hasPendingStays(
      ownedProperty.id
    );
    if (hasPendingStays) {
      throw new ConflictError(
        "This property has upcoming or in-progress stays. Cancel them before deleting it."
      );
    }

    ownedProperty.softDelete();
    await this.propertyRepository.save(ownedProperty);
  }
}
