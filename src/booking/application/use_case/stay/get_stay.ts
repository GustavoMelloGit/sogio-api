import { ResourceNotFoundError } from "../../../../core/application/error/resource_not_found_error";
import type { UseCase } from "../../../../core/application/use_case/use_case";
import type { User } from "../../../../auth/domain/entity/user";
import type { StayRepository } from "../../../domain/repository/stay_repository";
import type { TenantRepository } from "../../../domain/repository/tenant_repository";
import type { PropertyRepository } from "../../../../property_management/domain/repository/property_repository";
import { PropertyOwnershipPolicy } from "../../../../property_management/domain/policy/property_ownership_policy";
import type { TenantSex } from "../../../domain/entity/tenant";

type Input = {
  stay_id: string;
};

type Output = {
  check_in: Date;
  check_out: Date;
  guests: number;
  id: string;
  entrance_code: string;
  price: number;
  source: string;
  created_at: Date;
  updated_at: Date;
  tenant: {
    id: string;
    name: string;
    phone: string;
    sex: TenantSex;
    created_at: Date;
    updated_at: Date;
  };
};

export class GetStayUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly propertyRepository: PropertyRepository,
    private readonly stayRepository: StayRepository,
    private readonly tenantRepository: TenantRepository
  ) {}

  async execute(input: Input, user: User): Promise<Output> {
    const stay = await this.stayRepository.stayOfId(input.stay_id);

    if (!stay) {
      throw new ResourceNotFoundError("Stay");
    }

    const property = await this.propertyRepository.propertyOfId(
      stay.property_id
    );
    PropertyOwnershipPolicy.ensureOwnership(property, user, "Stay");

    const tenant = await this.tenantRepository.tenantOfId(stay.tenant_id);

    if (!tenant) {
      throw new ResourceNotFoundError("Tenant");
    }

    return {
      id: stay.id,
      check_in: stay.check_in,
      check_out: stay.check_out,
      guests: stay.guests,
      entrance_code: stay.entrance_code,
      price: stay.price,
      source: stay.source,
      created_at: stay.created_at,
      updated_at: stay.updated_at,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        phone: tenant.phone,
        sex: tenant.sex,
        created_at: tenant.created_at,
        updated_at: tenant.updated_at,
      },
    };
  }
}
