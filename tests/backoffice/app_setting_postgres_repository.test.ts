import { describe, it, expect, beforeEach } from "bun:test";
import { truncate } from "../helpers/database";
import { AppSetting } from "../../src/backoffice/domain/entity/app_setting";
import { AppSettingPostgresRepository } from "../../src/backoffice/infra/database/postgres_repository/app_setting_postgres_repository";
import { ConflictError } from "../../src/core/application/error/conflict_error";

describe("AppSettingPostgresRepository", () => {
  const repository = new AppSettingPostgresRepository();

  beforeEach(async () => {
    await truncate(["app_settings"]);
  });

  it("translates a raw unique-key violation from the database into a ConflictError", async () => {
    const key = `app.duplicate.${crypto.randomUUID()}`;

    await repository.save(
      AppSetting.create({
        key,
        value: "first",
        type: "string",
        description: null,
      })
    );

    await expect(
      repository.save(
        AppSetting.create({
          key,
          value: "second",
          type: "string",
          description: null,
        })
      )
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
