import type { PropertyOccupancy } from "../../../property_management/domain/service/property_occupancy";
import type { StayRepository } from "../../domain/repository/stay_repository";
import type { CancelStayService } from "./cancel_stay_service";

/**
 * Implements `property_management`'s `PropertyOccupancy` port (DA-3-R) over
 * `StayRepository.allFutureFromProperty` — `check_out >= now` and not
 * deleted, exactly the union of "in progress" and "future" that
 * `DeletePropertyUseCase`'s cascade needs. No method-per-conjunction here on
 * purpose (§8.2): both conjuncts are needed in the same pass (one blocks,
 * the other gets cancelled), and this reuses the query
 * `ReconcileExternalBookingsUseCase` already depends on, instead of adding a
 * second one that could drift out of sync with it.
 */
export class StayPropertyOccupancy implements PropertyOccupancy {
  constructor(
    private readonly stayRepository: StayRepository,
    private readonly cancelStayService: CancelStayService
  ) {}

  async releaseFutureOccupancy(
    propertyId: string,
    ensureNoStayInProgress: (inProgressCount: number) => void
  ): Promise<number> {
    const pendingStays =
      await this.stayRepository.allFutureFromProperty(propertyId);

    // One snapshot: two separate `new Date()` calls could let a stay escape both sets.
    const now = new Date();
    const inProgress = pendingStays.filter(({ stay }) => stay.check_in <= now);
    const future = pendingStays.filter(({ stay }) => stay.check_in > now);

    ensureNoStayInProgress(inProgress.length);

    let canceledCount = 0;
    for (const { stay } of future) {
      /**
       * Rechecks the race between the query above and this cancellation
       * (§8.2): a stay classified as future here may have started in the
       * meantime. If it did, abort the whole operation with the same
       * conflict instead of skipping it — skipping would leave a live stay
       * on a property nobody can manage anymore.
       */
      if (stay.check_in <= new Date()) {
        ensureNoStayInProgress(1);
      }

      await this.cancelStayService.cancel(stay, propertyId);
      canceledCount++;
    }

    return canceledCount;
  }
}
