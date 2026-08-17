import type { PropertyRepository } from "../../domain/repository/property_repository";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../../auth/domain/entity/user";
import type { SafeUpdateEntity } from "../../../core/domain/entity/base_entity";
import type { PropertyData } from "../../domain/entity/property";
import type { DeepPartial } from "../../../core/application/types/deep_partial";
import { PropertyOwnershipPolicy } from "../../domain/policy/property_ownership_policy";

type Input = {
  property_id: string;
  update_data: DeepPartial<SafeUpdateEntity<PropertyData>>;
};

type Output = {
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
 * Use case para atualizar dados de uma propriedade
 */
export class UpdatePropertyUseCase implements UseCase<Input, Output> {
  constructor(private readonly propertyRepository: PropertyRepository) {}

  async execute(input: Input, user: User): Promise<Output> {
    const property = await this.propertyRepository.propertyOfId(
      input.property_id
    );
    const ownedProperty = PropertyOwnershipPolicy.ensureOwnership(
      property,
      user
    );

    ownedProperty.changeDetails(input.update_data);
    await this.propertyRepository.save(ownedProperty);

    return {
      id: ownedProperty.id,
      name: ownedProperty.name,
      user_id: ownedProperty.user_id,
      address: ownedProperty.address.data,
      images: ownedProperty.images,
      capacity: ownedProperty.capacity,
      created_at: ownedProperty.created_at,
      updated_at: ownedProperty.updated_at,
    };
  }
}
