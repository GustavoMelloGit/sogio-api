import { ResourceNotFoundError } from "../../../../core/application/error/resource_not_found_error";
import type { UseCase } from "../../../../core/application/use_case/use_case";
import type { User } from "../../../../auth/domain/entity/user";
import type { StayRepository } from "../../../domain/repository/stay_repository";
import type { PropertyRepository } from "../../../../property_management/domain/repository/property_repository";
import { PropertyOwnershipPolicy } from "../../../../property_management/domain/policy/property_ownership_policy";
import type { BookingPolicy } from "../../../domain/policy/booking_policy";

type Input = {
  stay_id: string;
  check_in?: Date;
  check_out?: Date;
  guests?: number;
  price?: number;
};

type Output = {
  id: string;
  check_in: Date;
  check_out: Date;
  guests: number;
  entrance_code: string;
  price: number;
  updated_at: Date;
};

export class UpdateStayUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly propertyRepository: PropertyRepository,
    private readonly stayRepository: StayRepository,
    private readonly bookingPolicy: BookingPolicy
  ) {}

  async execute(input: Input, user: User): Promise<Output> {
    const stay = await this.stayRepository.stayOfId(input.stay_id);

    if (!stay) {
      throw new ResourceNotFoundError("Stay");
    }

    const property = await this.propertyRepository.propertyOfId(
      stay.property_id
    );
    const ownedProperty = PropertyOwnershipPolicy.ensureOwnership(
      property,
      user,
      "Stay"
    );

    stay.update(input);

    await this.bookingPolicy.isBookingAllowed(
      ownedProperty.id,
      stay.check_in,
      stay.check_out,
      stay.id
    );

    await this.stayRepository.saveStay(stay);

    return {
      id: stay.id,
      check_in: stay.check_in,
      check_out: stay.check_out,
      guests: stay.guests,
      entrance_code: stay.entrance_code,
      price: stay.price,
      updated_at: stay.updated_at,
    };
  }
}
