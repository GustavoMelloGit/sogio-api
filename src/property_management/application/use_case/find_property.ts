import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../../auth/domain/entity/user";
import type { PropertyRepository } from "../../domain/repository/property_repository";
import { PropertyOwnershipPolicy } from "../../domain/policy/property_ownership_policy";

type Input = {
  property_id: string;
};

type Output = {
  id: string;
  name: string;
  capacity: number;
  images: string[];
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
  user_id: string;
  created_at: Date;
  updated_at: Date;
};

export class FindPropertyUseCase implements UseCase<Input, Output> {
  constructor(private readonly propertyRepository: PropertyRepository) {}

  async execute(input: Input, user: User): Promise<Output> {
    const property = await this.propertyRepository.propertyOfId(
      input.property_id
    );
    const ownedProperty = PropertyOwnershipPolicy.ensureOwnership(
      property,
      user
    );

    return {
      id: ownedProperty.id,
      name: ownedProperty.name,
      capacity: ownedProperty.capacity,
      images: ownedProperty.images,
      address: ownedProperty.address.data,
      user_id: ownedProperty.user_id,
      created_at: ownedProperty.created_at,
      updated_at: ownedProperty.updated_at,
    };
  }
}
