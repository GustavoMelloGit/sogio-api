import { ResourceNotFoundError } from "../../../../core/application/error/resource_not_found_error";
import type { UseCase } from "../../../../core/application/use_case/use_case";
import type { User } from "../../../../auth/domain/entity/user";
import type { ExternalBookingSourcesRepository } from "../../../domain/repository/external_booking_source_repository";
import type { PropertyRepository } from "../../../../property_management/domain/repository/property_repository";
import { PropertyOwnershipPolicy } from "../../../../property_management/domain/policy/property_ownership_policy";

type Input = {
  property_id: string;
  id: string;
  platform_name?: string;
  sync_url?: string;
};

type Output = {
  id: string;
  property_id: string;
  platform_name: string;
  sync_url: string;
  created_at: Date;
  updated_at: Date;
};

/**
 * Edits a connected calendar in place. `property_id` identifies the source
 * but is never patched — see `ExternalBookingSource.update()`.
 */
export class UpdateExternalBookingSourceUseCase
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

    const updated = existing.update({
      platform_name: input.platform_name,
      sync_url: input.sync_url,
    });

    await this.externalBookingSourceRepository.update(updated);

    return {
      id: updated.id,
      property_id: updated.property_id,
      platform_name: updated.platform_name,
      sync_url: updated.sync_url,
      created_at: updated.created_at,
      updated_at: updated.updated_at,
    };
  }
}
