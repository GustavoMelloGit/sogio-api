import { ResourceNotFoundError } from "../../../../core/application/error/resource_not_found_error";
import type { UseCase } from "../../../../core/application/use_case/use_case";
import type { User } from "../../../../auth/domain/entity/user";
import type { ExternalBookingSourcesRepository } from "../../../domain/repository/external_booking_source_repository";
import type { PropertyRepository } from "../../../../property_management/domain/repository/property_repository";
import { PropertyOwnershipPolicy } from "../../../../property_management/domain/policy/property_ownership_policy";

type Input = {
  property_id: string;
  id: string;
};

type Output = void;

/**
 * Disconnects a calendar from a property. Soft delete: the row stays, but
 * every read filters `deleted_at`, so reconciliation stops seeing the feed
 * immediately. Deleting twice is a 404 on the second call, not a state
 * error — same idiom as `DeleteLedgerEntryUseCase`.
 */
export class DeleteExternalBookingSourceUseCase
  implements UseCase<Input, Output>
{
  constructor(
    private readonly propertyRepository: PropertyRepository,
    private readonly externalBookingSourceRepository: ExternalBookingSourcesRepository
  ) {}

  async execute(input: Input, user: User): Promise<Output> {
    const property = await this.propertyRepository.propertyOfId(
      input.property_id
    );
    PropertyOwnershipPolicy.ensureOwnership(
      property,
      user,
      "External booking source"
    );

    const existing =
      await this.externalBookingSourceRepository.externalBookingSourceOfId(
        input.id
      );
    if (!existing || existing.property_id !== input.property_id) {
      throw new ResourceNotFoundError("External booking source");
    }

    await this.externalBookingSourceRepository.delete(existing.softDelete());
  }
}
