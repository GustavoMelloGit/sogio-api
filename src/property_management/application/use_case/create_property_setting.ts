import { ConflictError } from "../../../core/application/error/conflict_error";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../../auth/domain/entity/user";
import {
  PropertySetting,
  type PropertySettingType,
} from "../../domain/entity/property_setting";
import type { PropertySettingRepository } from "../../domain/repository/property_setting_repository";
import type { PropertyRepository } from "../../domain/repository/property_repository";
import { PropertyOwnershipPolicy } from "../../domain/policy/property_ownership_policy";

export const MAX_ACTIVE_PROPERTY_SETTINGS = 100;

type Input = {
  property_id: string;
  key: string;
  value: unknown;
  type: PropertySettingType;
  description?: string | null;
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

export class CreatePropertySettingUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly propertyRepository: PropertyRepository,
    private readonly propertySettingRepository: PropertySettingRepository
  ) {}

  async execute(input: Input, user: User): Promise<Output> {
    const property = await this.propertyRepository.propertyOfId(
      input.property_id
    );
    PropertyOwnershipPolicy.ensureOwnership(property, user);

    const existing = await this.propertySettingRepository.findByKey(
      input.key,
      input.property_id
    );
    if (existing) {
      throw new ConflictError("Property setting key already exists");
    }

    const setting = PropertySetting.create({
      property_id: input.property_id,
      key: input.key,
      value: input.value,
      type: input.type,
      description: input.description ?? null,
    });

    await this.propertySettingRepository.save(
      setting,
      MAX_ACTIVE_PROPERTY_SETTINGS
    );

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
