import { and, eq, ilike, isNull } from "drizzle-orm";
import { Tenant, type TenantData } from "../../../domain/entity/tenant";
import type { TenantRepository } from "../../../domain/repository/tenant_repository";
import { db } from "../../../../core/infra/database/drizzle/database";
import { currentExecutor } from "../../../../core/infra/database/drizzle/transaction_context";
import {
  tenantsTable,
  staysTable,
  propertiesTable,
} from "../../../../core/infra/database/drizzle/schema";

export class TenantPostgresRepository implements TenantRepository {
  async findByPhoneForOwner(
    ownerId: string,
    phone: string
  ): Promise<Tenant | null> {
    const tenant = await currentExecutor().query.tenantsTable.findFirst({
      where: and(
        eq(tenantsTable.owner_id, ownerId),
        eq(tenantsTable.phone, phone)
      ),
    });

    return tenant ? Tenant.reconstitute(tenant) : null;
  }

  async save(tenant: Tenant): Promise<Tenant> {
    const data: TenantData = {
      id: tenant.id,
      owner_id: tenant.owner_id,
      name: tenant.name,
      phone: tenant.phone,
      sex: tenant.sex,
      created_at: tenant.created_at,
      updated_at: tenant.updated_at,
      deleted_at: tenant.deleted_at,
    };
    const result = await currentExecutor()
      .insert(tenantsTable)
      .values(data)
      .returning();

    if (!result[0]) {
      throw new Error("Failed to save tenant");
    }

    return Tenant.reconstitute(result[0]);
  }

  async findAll(): Promise<Tenant[]> {
    const tenants = await db.select().from(tenantsTable);

    return tenants.map(tenant => Tenant.reconstitute(tenant));
  }

  async tenantOfId(id: string): Promise<Tenant | null> {
    const tenant = await db.query.tenantsTable.findFirst({
      where: eq(tenantsTable.id, id),
    });

    return tenant ? Tenant.reconstitute(tenant) : null;
  }

  async findByOwnerProperties(
    ownerId: string,
    query?: string
  ): Promise<{ id: string; name: string; phone: string; sex: string }[]> {
    const rows = await db
      .selectDistinct({
        id: tenantsTable.id,
        name: tenantsTable.name,
        phone: tenantsTable.phone,
        sex: tenantsTable.sex,
      })
      .from(tenantsTable)
      .innerJoin(staysTable, eq(staysTable.tenant_id, tenantsTable.id))
      .innerJoin(
        propertiesTable,
        eq(propertiesTable.id, staysTable.property_id)
      )
      .where(
        and(
          eq(propertiesTable.user_id, ownerId),
          isNull(tenantsTable.deleted_at),
          isNull(staysTable.deleted_at),
          // R-5: a tenant whose only stay is on a deleted property
          // disappears from GET /tenants, consistent with everything else
          // scoped by the property.
          isNull(propertiesTable.deleted_at),
          query ? ilike(tenantsTable.name, `%${query}%`) : undefined
        )
      );

    return rows;
  }
}
