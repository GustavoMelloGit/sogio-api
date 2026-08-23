import type { PropertyCheckTimes } from "../../domain/service/property_check_times";

export interface PropertyCheckTimesService {
  checkTimesOf(property_id: string): Promise<PropertyCheckTimes>;
}
