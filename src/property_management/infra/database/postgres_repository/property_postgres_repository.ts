import { and, count, eq, isNull, sql } from "drizzle-orm";
import { Property } from "../../../domain/entity/property";
import type { PropertyRepository } from "../../../domain/repository/property_repository";
import { db } from "../../../../core/infra/database/drizzle/database";
import {
  propertiesTable,
  addressesTable,
} from "../../../../core/infra/database/drizzle/schema";
import { Address } from "../../../domain/value_object/address";

/** Arbitrary namespace for `pg_advisory_xact_lock`, scoped to property
 *  creation so it never collides with other advisory lock uses. */
const PROPERTY_QUOTA_LOCK_NAMESPACE = 728_314;

type DbExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

export class PropertyPostgresRepository implements PropertyRepository {
  /**
   * Deliberately does NOT filter `deleted_at` (R-2): `save()` calls this
   * first to decide INSERT vs UPDATE, and the soft delete write itself goes
   * through `save()`. Filtering here would make the exclusion write take the
   * INSERT path on a row that already exists — primary key violation, 500.
   * Authorization for a soft-deleted property is `PropertyOwnershipPolicy`'s
   * job, not this method's.
   */
  async propertyOfId(id: string): Promise<Property | null> {
    const property = await db.query.propertiesTable.findFirst({
      where: eq(propertiesTable.id, id),
      with: {
        address: true,
      },
    });

    if (!property) return null;

    return Property.reconstitute(property);
  }

  async save(input: Property): Promise<void> {
    const propertyAlreadyExists = await this.propertyOfId(input.id);
    if (propertyAlreadyExists) {
      await this.#updateProperty(input);
    } else {
      await this.#createProperty(input);
    }
  }

  async allFromUser(userId: string): Promise<Array<Property>> {
    const properties = await db.query.propertiesTable.findMany({
      where: and(
        eq(propertiesTable.user_id, userId),
        isNull(propertiesTable.deleted_at)
      ),
      with: {
        address: true,
      },
    });
    return properties.map(property => Property.reconstitute(property));
  }

  async countFromUser(userId: string): Promise<number> {
    const result = await db
      .select({ total: count() })
      .from(propertiesTable)
      .where(
        and(
          eq(propertiesTable.user_id, userId),
          isNull(propertiesTable.deleted_at)
        )
      );

    return result[0]?.total ?? 0;
  }

  async saveNewWithinQuota(
    property: Property,
    ensureWithinQuota: (currentCount: number) => void
  ): Promise<void> {
    await db.transaction(async tx => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${PROPERTY_QUOTA_LOCK_NAMESPACE}, hashtext(${property.user_id}))`
      );

      const result = await tx
        .select({ total: count() })
        .from(propertiesTable)
        .where(
          and(
            eq(propertiesTable.user_id, property.user_id),
            isNull(propertiesTable.deleted_at)
          )
        );
      const currentCount = result[0]?.total ?? 0;

      ensureWithinQuota(currentCount);

      await this.#createProperty(property, tx);
    });
  }

  async #createAddress(
    address: Address,
    executor: DbExecutor = db
  ): Promise<{ value: Address; id: string }> {
    const addressResult = await executor
      .insert(addressesTable)
      .values(address.data)
      .returning();
    if (!addressResult[0]) throw new Error("Failed to create address");

    return {
      value: Address.reconstitute(addressResult[0]),
      id: addressResult[0].id,
    };
  }

  async #updateAddress(addressId: string, address: Address): Promise<void> {
    const addressResult = await db
      .update(addressesTable)
      .set(address.data)
      .where(eq(addressesTable.id, addressId))
      .returning();

    if (!addressResult[0]) throw new Error("Failed to update address");
  }

  async #createProperty(
    property: Property,
    executor: DbExecutor = db
  ): Promise<Property> {
    const address = await this.#createAddress(property.address, executor);
    const propertyResult = await executor
      .insert(propertiesTable)
      .values({
        ...property.data,
        address_id: address.id,
      })
      .returning();

    if (!propertyResult[0]) throw new Error("Failed to create property");

    return property;
  }

  async #updateProperty(property: Property): Promise<void> {
    const propertyResult = await db
      .update(propertiesTable)
      .set(property.data)
      .where(eq(propertiesTable.id, property.id))
      .returning();

    const propertyDto = propertyResult[0];
    if (!propertyDto) throw new Error("Failed to update property");

    await this.#updateAddress(propertyDto.address_id, property.address);
  }
}
