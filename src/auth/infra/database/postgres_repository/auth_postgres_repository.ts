import { eq, inArray } from "drizzle-orm";
import {
  User,
  type UserData,
  type UserRole,
} from "../../../domain/entity/user";
import type { AuthRepository } from "../../../domain/repository/auth_repository";
import { db } from "../../../../core/infra/database/drizzle/database";
import {
  usersTable,
  propertiesTable,
  addressesTable,
  externalBookingSources,
  propertySettingsTable,
} from "../../../../core/infra/database/drizzle/schema";

type UserRow = typeof usersTable.$inferSelect;

function rowToUserData(row: UserRow): UserData {
  const role: UserRole =
    row.role === "admin" || row.role === "user" ? row.role : "user";
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    password: row.password,
    role,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? undefined,
  };
}

export class AuthPostgresRepository implements AuthRepository {
  async findUserById(id: string): Promise<User | null> {
    const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, id),
    });

    return user ? User.reconstitute(rowToUserData(user)) : null;
  }

  async addUser(input: User): Promise<User> {
    const data = {
      id: input.id,
      name: input.name,
      email: input.email,
      password: input.password,
      role: input.role,
      created_at: input.created_at,
      updated_at: input.updated_at,
      deleted_at: input.deleted_at,
    };
    const result = await db.insert(usersTable).values(data).returning();

    const row = result[0];

    if (!row) {
      throw new Error("Failed to save user");
    }

    return User.reconstitute(rowToUserData(row));
  }

  async findUserByEmail(email: string): Promise<User | null> {
    const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.email, email),
    });

    return user ? User.reconstitute(rowToUserData(user)) : null;
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await db
      .update(usersTable)
      .set({ password: passwordHash, updated_at: new Date() })
      .where(eq(usersTable.id, userId));
  }

  async purgeUserData(userId: string): Promise<void> {
    await db.transaction(async tx => {
      const properties = await tx.query.propertiesTable.findMany({
        where: eq(propertiesTable.user_id, userId),
        columns: { id: true, address_id: true },
      });

      const propertyIds = properties.map(p => p.id);
      const addressIds = properties.map(p => p.address_id);

      if (propertyIds.length > 0) {
        // Both `property_settings` and `external_booking_sources` reference
        // `properties` with `ON DELETE no action`, so they must be purged
        // explicitly before `users` is deleted — otherwise the cascade from
        // `properties.user_id` (ON DELETE cascade) fails midway, leaving the
        // account partially destroyed.
        await tx
          .delete(propertySettingsTable)
          .where(inArray(propertySettingsTable.property_id, propertyIds));

        await tx
          .delete(externalBookingSources)
          .where(inArray(externalBookingSources.property_id, propertyIds));
      }

      await tx.delete(usersTable).where(eq(usersTable.id, userId));

      if (addressIds.length > 0) {
        await tx
          .delete(addressesTable)
          .where(inArray(addressesTable.id, addressIds));
      }
    });
  }
}
