import type { Tenant } from "../entity/tenant";

export interface TenantRepository {
  tenantOfId(id: string): Promise<Tenant | null>;
  findByPhoneForOwner(ownerId: string, phone: string): Promise<Tenant | null>;
  save(tenant: Tenant): Promise<Tenant>;
  findAll(): Promise<Tenant[]>;
  findByOwnerProperties(
    ownerId: string,
    query?: string
  ): Promise<{ id: string; name: string; phone: string; sex: string }[]>;
}
