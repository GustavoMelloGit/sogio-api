import type { UseCase } from "../../../core/application/use_case/use_case";
import type { EntitlementService } from "../../../billing/application/service/entitlement_service";
import type { PropertyRepository } from "../../domain/repository/property_repository";
import { Property } from "../../domain/entity/property";
import { CapabilityLimitPolicy } from "../../../billing/domain/policy/capability_limit_policy";

export type CreatePropertyInput = {
  name: string;
  user_id: string;
  address: {
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state: string;
    zip_code: string;
    country: string;
    complement: string;
  };
  images: string[];
  capacity: number;
};

export type CreatePropertyOutput = {
  id: string;
  name: string;
  user_id: string;
  address: {
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state: string;
    zip_code: string;
    country: string;
    complement: string;
  };
  images: string[];
  capacity: number;
  created_at: Date;
  updated_at: Date;
};

/**
 * Use case para criar uma nova propriedade
 */
export class CreatePropertyUseCase
  implements UseCase<CreatePropertyInput, CreatePropertyOutput>
{
  constructor(
    private readonly propertyRepository: PropertyRepository,
    private readonly entitlementService: EntitlementService
  ) {}

  async execute(input: CreatePropertyInput): Promise<CreatePropertyOutput> {
    const entitlement = await this.entitlementService.entitlementOf(
      input.user_id
    );
    const property = Property.create(input);

    await this.propertyRepository.saveNewWithinQuota(property, currentCount =>
      CapabilityLimitPolicy.ensureWithinLimit(
        "max_properties",
        currentCount,
        entitlement.capabilities.limitOf("max_properties")
      )
    );

    return {
      id: property.id,
      name: property.name,
      user_id: property.user_id,
      address: property.address.data,
      images: property.images,
      capacity: property.capacity,
      created_at: property.created_at,
      updated_at: property.updated_at,
    };
  }
}
