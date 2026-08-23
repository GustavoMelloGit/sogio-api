import { and, count, eq, isNull, sql } from "drizzle-orm";
import { Property } from "../../../domain/entity/property";
import type { PropertyRepository } from "../../../domain/repository/property_repository";
import { db } from "../../../../core/infra/database/drizzle/database";
import {
  currentExecutor,
  type DbExecutor,
} from "../../../../core/infra/database/drizzle/transaction_context";
import {
  propertiesTable,
  addressesTable,
} from "../../../../core/infra/database/drizzle/schema";
import { Address } from "../../../domain/value_object/address";

/** Arbitrary namespace for `pg_advisory_xact_lock`, scoped to property
 *  creation so it never collides with other advisory lock uses. */
const PROPERTY_QUOTA_LOCK_NAMESPACE = 728_314;

export class PropertyPostgresRepository implements PropertyRepository {
  /**
   * Deliberately does NOT filter `deleted_at` (R-2): `save()` calls this
   * first to decide INSERT vs UPDATE, and the soft delete write itself goes
   * through `save()`. Filtering here would make the exclusion write take the
   * INSERT path on a row that already exists — primary key violation, 500.
   * Authorization for a soft-deleted property is `PropertyOwnershipPolicy`'s
   * job, not this method's.
   *
   * Reads through `currentExecutor()` (DA-13): `save()` calls this from
   * inside `DeletePropertyUseCase`'s transaction, and a plain `db.query`
   * there would open a second pool connection while the first is still held
   * — deadlocks the pool under concurrent deletions (same hazard as
   * `StayPostgresRepository.allFutureFromProperty`). Resolves to plain `db`
   * outside `TransactionRunner.run`, unchanged from before.
   */
  async propertyOfId(id: string): Promise<Property | null> {
    const property = await currentExecutor().query.propertiesTable.findFirst({
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
    const ambientExecutor = currentExecutor();
    if (ambientExecutor === db) {
      await db.transaction(tx =>
        this.#saveNewWithinQuota(property, ensureWithinQuota, tx)
      );
    } else {
      await this.#saveNewWithinQuota(
        property,
        ensureWithinQuota,
        ambientExecutor
      );
    }
  }

  async #saveNewWithinQuota(
    property: Property,
    ensureWithinQuota: (currentCount: number) => void,
    executor: DbExecutor
  ): Promise<void> {
    await executor.execute(
      sql`select pg_advisory_xact_lock(${PROPERTY_QUOTA_LOCK_NAMESPACE}, hashtext(${property.user_id}))`
    );

    const result = await executor
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

    await this.#createProperty(property, executor);
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

  async #updateAddress(
    addressId: string,
    address: Address,
    executor: DbExecutor = db
  ): Promise<void> {
    const addressResult = await executor
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

  /**
   * Writes through `currentExecutor()` (DA-13) so a soft delete running
   * inside `DeletePropertyUseCase`'s transaction commits or rolls back
   * together with the stay cancellations and ledger reversals it triggers.
   * Outside a `TransactionRunner.run` call this resolves to plain `db`,
   * unchanged from before.
   */
  async #updateProperty(property: Property): Promise<void> {
    const executor = currentExecutor();
    const propertyResult = await executor
      .update(propertiesTable)
      .set(property.data)
      .where(eq(propertiesTable.id, property.id))
      .returning();

    const propertyDto = propertyResult[0];
    if (!propertyDto) throw new Error("Failed to update property");

    await this.#updateAddress(
      propertyDto.address_id,
      property.address,
      executor
    );
  }
}
