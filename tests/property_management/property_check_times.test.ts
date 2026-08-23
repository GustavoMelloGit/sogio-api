import { describe, it, expect, beforeEach } from "bun:test";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { ConsoleLogger } from "../../src/core/infra/logger/console_logger";
import { PropertySetting } from "../../src/property_management/domain/entity/property_setting";
import { PropertySettingPostgresRepository } from "../../src/property_management/infra/database/postgres_repository/property_setting_postgres_repository";
import { SettingPropertyCheckTimesService } from "../../src/property_management/application/service/setting_property_check_times_service";

const TABLES = ["property_settings", "properties", "addresses", "users"];

function makeService(): SettingPropertyCheckTimesService {
  return new SettingPropertyCheckTimesService(
    new PropertySettingPostgresRepository(),
    new ConsoleLogger()
  );
}

async function saveSetting(
  propertyId: string,
  key: string,
  value: unknown,
  type: "string" | "number" = "string"
): Promise<void> {
  await new PropertySettingPostgresRepository().save(
    PropertySetting.create({
      property_id: propertyId,
      key,
      value,
      type,
      description: null,
    }),
    10
  );
}

async function property(email: string) {
  const { user } = await createUserFixture({
    name: "João Silva",
    email,
    password: "password123",
  });
  return createPropertyFixture({ userId: user.id });
}

describe("SettingPropertyCheckTimesService", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("returns 14:00 / 11:00 when the property has no check time settings", async () => {
    const target = await property("check-times-default@sogio.dev");

    const checkTimes = await makeService().checkTimesOf(target.id);

    expect(checkTimes.check_in.toString()).toBe("14:00");
    expect(checkTimes.check_out.toString()).toBe("11:00");
  });

  it("returns the configured times", async () => {
    const target = await property("check-times-configured@sogio.dev");
    await saveSetting(target.id, "check_in_time", "16:30");
    await saveSetting(target.id, "check_out_time", "09:05");

    const checkTimes = await makeService().checkTimesOf(target.id);

    expect(checkTimes.check_in.toString()).toBe("16:30");
    expect(checkTimes.check_out.toString()).toBe("09:05");
  });

  it("falls back per key, so one broken setting does not lose the other", async () => {
    const target = await property("check-times-partial@sogio.dev");
    await saveSetting(target.id, "check_in_time", "16:30");
    await saveSetting(target.id, "check_out_time", "25:00");

    const checkTimes = await makeService().checkTimesOf(target.id);

    expect(checkTimes.check_in.toString()).toBe("16:30");
    expect(checkTimes.check_out.toString()).toBe("11:00");
  });

  it("falls back when the setting is not even a string", async () => {
    const target = await property("check-times-wrong-type@sogio.dev");
    await saveSetting(target.id, "check_in_time", 14, "number");

    const checkTimes = await makeService().checkTimesOf(target.id);

    expect(checkTimes.check_in.toString()).toBe("14:00");
  });

  it("ignores a soft-deleted setting", async () => {
    const repository = new PropertySettingPostgresRepository();
    const target = await property("check-times-deleted@sogio.dev");
    await saveSetting(target.id, "check_in_time", "16:30");

    const setting = await repository.findByKey("check_in_time", target.id);
    await repository.delete(setting!.softDelete());

    const checkTimes = await makeService().checkTimesOf(target.id);

    expect(checkTimes.check_in.toString()).toBe("14:00");
  });
});
