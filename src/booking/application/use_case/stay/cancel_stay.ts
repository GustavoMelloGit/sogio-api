import { ResourceNotFoundError } from "../../../../core/application/error/resource_not_found_error";
import type { UseCase } from "../../../../core/application/use_case/use_case";
import type { User } from "../../../../auth/domain/entity/user";
import type { StayRepository } from "../../../domain/repository/stay_repository";
import type { PropertyRepository } from "../../../../property_management/domain/repository/property_repository";
import { PropertyOwnershipPolicy } from "../../../../property_management/domain/policy/property_ownership_policy";
import type { CancelStayService } from "../../service/cancel_stay_service";

type Input = {
  stay_id: string;
};

type Output = {
  id: string;
  cancelled_at: Date;
};

export class CancelStayUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly stayRepository: StayRepository,
    private readonly propertyRepository: PropertyRepository,
    private readonly cancelStayService: CancelStayService
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

    await this.cancelStayService.cancel(stay, ownedProperty.id);

    return {
      id: stay.id,
      cancelled_at: stay.deleted_at!,
    };
  }
}
