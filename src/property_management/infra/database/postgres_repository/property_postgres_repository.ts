import { and, count, eq, isNull } from "drizzle-orm";
import { Property } from "../../../domain/entity/property";
import type { PropertyRepository } from "../../../domain/repository/property_repository";
import { db } from "../../../../core/infra/database/drizzle/database";
import {
  propertiesTable,
  addressesTable,
} from "../../../../core/infra/database/drizzle/schema";
import { Address } from "../../../domain/value_object/address";

export class PropertyPostgresRepository implements PropertyRepository {
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
      where: eq(propertiesTable.user_id, userId),
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

  async #createAddress(
    address: Address
  ): Promise<{ value: Address; id: string }> {
    const addressResult = await db
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

  async #createProperty(property: Property): Promise<Property> {
    const address = await this.#createAddress(property.address);
    const propertyResult = await db
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
