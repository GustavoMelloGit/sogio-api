import type {
  PaginatedResult,
  PaginationInput,
} from "../../../core/application/dto/pagination";
import type { Stay } from "../entity/stay";
import type { Tenant } from "../entity/tenant";

export type StayWithTenant = {
  stay: Stay;
  tenant: Tenant;
};

export type AllFromPropertyFilters = {
  from?: Date;
  to?: Date;
};

export type DashboardStatsResult = {
  active_stays: number;
  upcoming_check_ins: number;
  upcoming_stays: Array<{
    id: string;
    property_id: string;
    property_name: string;
    check_in: Date;
    tenant: { name: string };
  }>;
};

export interface StayRepository {
  stayOfId(id: string): Promise<Stay | null>;
  stayWithTenantOfId(id: string): Promise<StayWithTenant | null>;
  saveStay(stay: Stay): Promise<void>;
  allFutureFromProperty(propertyId: string): Promise<Array<StayWithTenant>>;
  allFromProperty(
    propertyId: string,
    pagination: PaginationInput,
    filters?: AllFromPropertyFilters
  ): Promise<PaginatedResult<StayWithTenant>>;
  tenantWithPhone(phone: string): Promise<Tenant | null>;
  dashboardStats(
    propertyIds: string[],
    date: Date
  ): Promise<DashboardStatsResult>;
}
