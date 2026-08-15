import { ResourceNotFoundError } from "../../../core/application/error/resource_not_found_error";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../../auth/domain/entity/user";
import type { PropertySettingRepository } from "../../domain/repository/property_setting_repository";
import type { PropertyRepository } from "../../domain/repository/property_repository";
import { PropertyOwnershipPolicy } from "../../domain/policy/property_ownership_policy";

type Input = {
  property_id: string;
  id: string;
};

type Output = void;

export class DeletePropertySettingUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly propertyRepository: PropertyRepository,
    private readonly propertySettingRepository: PropertySettingRepository
  ) {}

  async execute(input: Input, user: User): Promise<Output> {
    const property = await this.propertyRepository.propertyOfId(
      input.property_id
    );
    PropertyOwnershipPolicy.ensureOwnership(property, user);

    const existing = await this.propertySettingRepository.findById(input.id);
    if (!existing || existing.property_id !== input.property_id) {
      throw new ResourceNotFoundError("Property setting");
    }

    const deleted = existing.softDelete();
    await this.propertySettingRepository.delete(deleted);
  }
}
