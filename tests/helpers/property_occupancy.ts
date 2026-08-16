import { StayPropertyOccupancy } from "../../src/booking/application/service/stay_property_occupancy";
import { CancelStayService } from "../../src/booking/application/service/cancel_stay_service";
import { StayPostgresRepository } from "../../src/booking/infra/database/postgres_repository/stay_postgres_repository";
import { inMemoryEventDispatcher } from "../../src/core/infra/event/in_memory_event_dispatcher";
import type { PropertyOccupancy } from "../../src/property_management/domain/service/property_occupancy";

export function makeTestPropertyOccupancy(): PropertyOccupancy {
  const stayRepository = new StayPostgresRepository();
  const cancelStayService = new CancelStayService(
    stayRepository,
    inMemoryEventDispatcher
  );
  return new StayPropertyOccupancy(stayRepository, cancelStayService);
}
