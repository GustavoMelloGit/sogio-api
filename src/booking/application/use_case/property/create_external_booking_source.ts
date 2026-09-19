import { type ExternalBookingSourcesRepository } from "../../../domain/repository/external_booking_source_repository";
import type { UseCase } from "../../../../core/application/use_case/use_case";
import type { User } from "../../../../auth/domain/entity/user";
import { ExternalBookingSource } from "../../../domain/entity/external_booking_source";
import type { PropertyRepository } from "../../../../property_management/domain/repository/property_repository";
import { PropertyOwnershipPolicy } from "../../../../property_management/domain/policy/property_ownership_policy";

type Input = {
  property_id: string;
  platform_name: string;
  sync_url: string;
};

type Output = {
  id: string;
  property_id: string;
  platform_name: string;
  sync_url: string;
};

/**
 * Ownership goes through `PropertyOwnershipPolicy`, like every other
 * property-scoped use case. It used to be an inline
 * `property.user_id !== user_id` check against `BookingPropertyRepository`,
 * which besides duplicating the gate never looked at `deleted_at` — so a
 * calendar could be attached to an already-deleted property.
 */
export class CreateExternalBookingSourceUseCase
  implements UseCase<Input, Output>
{
  constructor(
    private readonly externalBookingSourceRepository: ExternalBookingSourcesRepository,
    private readonly propertyRepository: PropertyRepository
  ) {}

  async execute(input: Input, user: User): Promise<Output> {
    const { property_id, platform_name, sync_url } = input;

    const property = await this.propertyRepository.propertyOfId(property_id);
    PropertyOwnershipPolicy.ensureOwnership(property, user);

    const bookingSource = ExternalBookingSource.create({
      property_id: property_id,
      platform_name: platform_name,
      sync_url: sync_url,
    });

    await this.externalBookingSourceRepository.save(bookingSource);

    return {
      id: bookingSource.id,
      platform_name: bookingSource.platform_name,
      property_id: bookingSource.property_id,
      sync_url: bookingSource.sync_url,
    };
  }
}
