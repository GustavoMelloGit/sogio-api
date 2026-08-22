import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import type { Stay } from "../../domain/entity/stay";
import type { Tenant } from "../../domain/entity/tenant";
import { StayCanceledEvent } from "../../domain/event/stay_canceled_event";
import type { StayRepository } from "../../domain/repository/stay_repository";

/**
 * Cancels a stay and dispatches `StayCanceledEvent` — the cancel -> save ->
 * dispatch sequence that used to live inline in `CancelStayUseCase`.
 * Extracted (DA-3-R) so `StayPropertyOccupancy.releaseFutureOccupancy` can
 * cancel a stay exactly the same way `CancelStayUseCase` does, without a
 * second copy of the sequence that would drift out of sync with it — e.g.
 * the ledger reversal `StayCanceledEvent` triggers falling out of step with
 * direct cancellations the next time either one changes.
 */
export class CancelStayService {
  constructor(
    private readonly stayRepository: StayRepository,
    private readonly eventDispatcher: EventDispatcher
  ) {}

  async cancel(stay: Stay, tenant: Tenant, propertyId: string): Promise<void> {
    stay.cancel();
    await this.stayRepository.saveStay(stay);

    const event = new StayCanceledEvent(
      stay.id,
      propertyId,
      stay.price,
      tenant.name,
      stay.check_in,
      stay.check_out
    );
    await this.eventDispatcher.dispatch(event);
  }
}
