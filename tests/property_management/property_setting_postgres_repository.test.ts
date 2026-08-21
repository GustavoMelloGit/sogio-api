import { describe, it, expect, beforeEach } from "bun:test";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { PropertySetting } from "../../src/property_management/domain/entity/property_setting";
import { PropertySettingPostgresRepository } from "../../src/property_management/infra/database/postgres_repository/property_setting_postgres_repository";
import { ConflictError } from "../../src/core/application/error/conflict_error";

const TABLES = ["property_settings", "properties", "addresses", "users"];

describe("PropertySettingPostgresRepository", () => {
  const repository = new PropertySettingPostgresRepository();

  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("translates a raw unique-key violation from the database into a ConflictError", async () => {
    const { user } = await createUserFixture({
      name: "Property Owner",
      email: `owner-${crypto.randomUUID()}@sogio.dev`,
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const key = `checkin.instructions.${crypto.randomUUID()}`;

    await repository.save(
      PropertySetting.create({
        property_id: property.id,
        key,
        value: "first",
        type: "string",
        description: null,
      }),
      10
    );

    await expect(
      repository.save(
        PropertySetting.create({
          property_id: property.id,
          key,
          value: "second",
          type: "string",
          description: null,
        }),
        10
      )
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
