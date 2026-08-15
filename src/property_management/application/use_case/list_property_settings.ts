import type { UseCase } from "../../../core/application/use_case/use_case";
import type {
  PaginatedResult,
  PaginationInput,
} from "../../../core/application/dto/pagination";
import type { User } from "../../../auth/domain/entity/user";
import type { PropertySettingType } from "../../domain/entity/property_setting";
import type { PropertySettingRepository } from "../../domain/repository/property_setting_repository";
import type { PropertyRepository } from "../../domain/repository/property_repository";
import { PropertyOwnershipPolicy } from "../../domain/policy/property_ownership_policy";

type Input = {
  property_id: string;
  pagination: PaginationInput;
};

type PropertySettingDto = {
  id: string;
  property_id: string;
  key: string;
  value: unknown;
  type: PropertySettingType;
  description: string | null;
  created_at: Date;
  updated_at: Date;
};

type Output = PaginatedResult<PropertySettingDto>;

export class ListPropertySettingsUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly propertyRepository: PropertyRepository,
    private readonly propertySettingRepository: PropertySettingRepository
  ) {}

  async execute(input: Input, user: User): Promise<Output> {
    const property = await this.propertyRepository.propertyOfId(
      input.property_id
    );
    PropertyOwnershipPolicy.ensureOwnership(property, user);

    const result = await this.propertySettingRepository.list(
      input.property_id,
      input.pagination
    );

    return {
      data: result.data.map(setting => ({
        id: setting.id,
        property_id: setting.property_id,
        key: setting.key,
        value: setting.value,
        type: setting.type,
        description: setting.description,
        created_at: setting.created_at,
        updated_at: setting.updated_at,
      })),
      pagination: result.pagination,
    };
  }
}
