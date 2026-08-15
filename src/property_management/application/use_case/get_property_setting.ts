import { ResourceNotFoundError } from "../../../core/application/error/resource_not_found_error";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../../auth/domain/entity/user";
import type { PropertySettingType } from "../../domain/entity/property_setting";
import type { PropertySettingRepository } from "../../domain/repository/property_setting_repository";
import type { PropertyRepository } from "../../domain/repository/property_repository";
import { PropertyOwnershipPolicy } from "../../domain/policy/property_ownership_policy";

type Input = {
  property_id: string;
  id: string;
};

type Output = {
  id: string;
  property_id: string;
  key: string;
  value: unknown;
  type: PropertySettingType;
  description: string | null;
  created_at: Date;
  updated_at: Date;
};

export class GetPropertySettingUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly propertyRepository: PropertyRepository,
    private readonly propertySettingRepository: PropertySettingRepository
  ) {}

  async execute(input: Input, user: User): Promise<Output> {
    const property = await this.propertyRepository.propertyOfId(
      input.property_id
    );
    PropertyOwnershipPolicy.ensureOwnership(property, user);

    const setting = await this.propertySettingRepository.findById(input.id);
    if (!setting || setting.property_id !== input.property_id) {
      throw new ResourceNotFoundError("Property setting");
    }

    return {
      id: setting.id,
      property_id: setting.property_id,
      key: setting.key,
      value: setting.value,
      type: setting.type,
      description: setting.description,
      created_at: setting.created_at,
      updated_at: setting.updated_at,
    };
  }
}
