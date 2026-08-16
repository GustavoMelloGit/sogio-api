import type {
  StayRepository,
  StayWithTenant,
} from "../../../domain/repository/stay_repository";
import type { UseCase } from "../../../../core/application/use_case/use_case";
import type { User } from "../../../../auth/domain/entity/user";
import type { TenantSex } from "../../../domain/entity/tenant";
import type { PropertyRepository } from "../../../../property_management/domain/repository/property_repository";
import { PropertyOwnershipPolicy } from "../../../../property_management/domain/policy/property_ownership_policy";
import {
  type PaginatedResult,
  type PaginationInput,
} from "../../../../core/application/dto/pagination";

export class FindPropertyStaysUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly propertyRepository: PropertyRepository,
    private readonly stayRepository: StayRepository
  ) {}

  async execute(input: Input, user: User): Promise<Output> {
    const property = await this.propertyRepository.propertyOfId(
      input.property_id
    );
    PropertyOwnershipPolicy.ensureOwnership(property, user, "Stay");

    const { data, pagination } = await this.stayRepository.allFromProperty(
      input.property_id,
      input.pagination,
      {
        from: input.filters.from,
        to: input.filters.to,
      }
    );

    return {
      data: data.map(stay => this.#mapStayWithTenant(stay)),
      pagination,
    };
  }

  #mapStayWithTenant({ stay, tenant }: StayWithTenant): Output["data"][number] {
    return {
      id: stay.id,
      check_in: stay.check_in,
      check_out: stay.check_out,
      entrance_code: stay.entrance_code,
      guests: stay.guests,
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

type InputFilters = {
  from?: Date;
  to?: Date;
};

type Input = {
  property_id: string;
  pagination: PaginationInput;
  filters: InputFilters;
};

type Output = PaginatedResult<{
  id: string;
  check_in: Date;
  check_out: Date;
  entrance_code: string;
  guests: number;
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
}>;
