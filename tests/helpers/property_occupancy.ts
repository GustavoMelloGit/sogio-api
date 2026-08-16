import { StayPropertyOccupancy } from "../../src/booking/application/service/stay_property_occupancy";
import { StayPostgresRepository } from "../../src/booking/infra/database/postgres_repository/stay_postgres_repository";
import type { PropertyOccupancy } from "../../src/property_management/domain/service/property_occupancy";

export function makeTestPropertyOccupancy(): PropertyOccupancy {
  return new StayPropertyOccupancy(new StayPostgresRepository());
}
