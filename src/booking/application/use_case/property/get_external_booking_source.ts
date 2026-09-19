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

type Output = {
  id: string;
  property_id: string;
  platform_name: string;
  sync_url: string;
  created_at: Date;
  updated_at: Date;
};

export class GetExternalBookingSourceUseCase implements UseCase<Input, Output> {
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

    const source =
      await this.externalBookingSourceRepository.externalBookingSourceOfId(
        input.id
      );
    if (!source || source.property_id !== input.property_id) {
      throw new ResourceNotFoundError("External booking source");
    }

    return {
      id: source.id,
      property_id: source.property_id,
      platform_name: source.platform_name,
      sync_url: source.sync_url,
      created_at: source.created_at,
      updated_at: source.updated_at,
    };
  }
}
