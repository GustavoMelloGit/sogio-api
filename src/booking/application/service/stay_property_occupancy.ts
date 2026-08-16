import type { PropertyOccupancy } from "../../../property_management/domain/service/property_occupancy";
import type { StayRepository } from "../../domain/repository/stay_repository";

/**
 * Implements `property_management`'s `PropertyOccupancy` port over
 * `StayRepository.allFutureFromProperty` — `check_out >= now` and not
 * deleted, exactly the "future or in-progress" semantics `DeletePropertyUseCase`
 * needs (DA-3). No rule of its own.
 */
export class StayPropertyOccupancy implements PropertyOccupancy {
  constructor(private readonly stayRepository: StayRepository) {}

  async hasPendingStays(propertyId: string): Promise<boolean> {
    const pendingStays =
      await this.stayRepository.allFutureFromProperty(propertyId);
    return pendingStays.length > 0;
  }
}
