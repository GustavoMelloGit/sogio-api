import type { UseCase } from "../../../../core/application/use_case/use_case";
import type { User } from "../../../../auth/domain/entity/user";
import type { ExternalBookingSourcesRepository } from "../../../domain/repository/external_booking_source_repository";
import type { PropertyRepository } from "../../../../property_management/domain/repository/property_repository";
import { PropertyOwnershipPolicy } from "../../../../property_management/domain/policy/property_ownership_policy";

type Input = {
  property_id: string;
};

type ExternalBookingSourceDto = {
  id: string;
  property_id: string;
  platform_name: string;
  sync_url: string;
  created_at: Date;
  updated_at: Date;
};

type Output = {
  external_booking_sources: ExternalBookingSourceDto[];
};

/**
 * Lists every calendar connected to a property, in full — deliberately not
 * paginated.
 *
 * `ListPropertySettingsUseCase` is paginated, and its MCP tool has to spend a
 * sentence asking the caller to page through before concluding a key is
 * absent. The bug that motivated this use case was precisely an assistant
 * concluding absence too fast (it reported "no calendar configured" for a
 * property that had a live Airbnb feed). A property holds a handful of
 * calendars, so returning all of them removes that failure mode instead of
 * documenting it. No new unboundedness: `ReconcileExternalBookingsUseCase`
 * already loads the whole set through the same repository method.
 */
export class ListExternalBookingSourcesUseCase
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
    PropertyOwnershipPolicy.ensureOwnership(property, user);

    const sources = await this.externalBookingSourceRepository.allFromProperty(
      input.property_id
    );

    return {
      external_booking_sources: sources.map(source => ({
        id: source.id,
        property_id: source.property_id,
        platform_name: source.platform_name,
        sync_url: source.sync_url,
        created_at: source.created_at,
        updated_at: source.updated_at,
      })),
    };
  }
}
