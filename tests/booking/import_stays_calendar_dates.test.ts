import { describe, it, expect, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { upgradeToPro } from "../helpers/fixtures/plan";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { db } from "../../src/core/infra/database/drizzle/database";
import {
  ledgerEntriesTable,
  propertySettingsTable,
  staysTable,
  usersTable,
} from "../../src/core/infra/database/drizzle/schema";
import { PropertySetting } from "../../src/property_management/domain/entity/property_setting";
import { PropertySettingPostgresRepository } from "../../src/property_management/infra/database/postgres_repository/property_setting_postgres_repository";

const TABLES = [
  "ledger_entries",
  "stays",
  "tenants",
  "property_settings",
  "properties",
  "addresses",
  "users",
];

const HEADER =
  "property_id,check_in,check_out,guests,price,source,tenant_name,tenant_phone,tenant_sex";

type ImportSuccessBody = { imported: number };
type ImportFailureBody = {
  failures: Array<{ row: number; field: string | null; message: string }>;
};

function stayRow(fields: {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  phone: string;
  name?: string;
}): string {
  return [
    fields.propertyId,
    fields.checkIn,
    fields.checkOut,
    "2",
    "100000",
    "AIRBNB",
    fields.name ?? "Mariana Ribeiro",
    fields.phone,
    "FEMALE",
  ].join(",");
}

async function importCsv(token: string, rows: string[]): Promise<Response> {
  return api("/import/stays", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "text/csv" },
    body: [HEADER, ...rows].join("\n"),
  });
}

async function setTimeZone(userId: string, timeZone: string): Promise<void> {
  await db
    .update(usersTable)
    .set({ time_zone: timeZone })
    .where(eq(usersTable.id, userId));
}

async function setCheckTime(
  propertyId: string,
  key: string,
  value: unknown
): Promise<void> {
  await new PropertySettingPostgresRepository().save(
    PropertySetting.create({
      property_id: propertyId,
      key,
      value,
      type: typeof value === "string" ? "string" : "number",
      description: null,
    }),
    10
  );
}

async function ownerInSaoPaulo(email: string) {
  const { user } = await createUserFixture({
    name: "João Silva",
    email,
    password: "password123",
  });
  await upgradeToPro(user.id);
  await setTimeZone(user.id, "America/Sao_Paulo");
  const property = await createPropertyFixture({ userId: user.id });
  const token = await createAuthToken(user.id);

  return { user, property, token };
}

function renderedIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone }).format(instant);
}

describe("POST /import/stays — pure dates become instants at the property's check times", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("anchors an imported date at the default check-in/check-out times in the owner's time zone", async () => {
    const { property, token } = await ownerInSaoPaulo(
      "import-dates-default@sogio.dev"
    );

    const res = await importCsv(token, [
      stayRow({
        propertyId: property.id,
        checkIn: "2030-07-10",
        checkOut: "2030-07-15",
        phone: "5511911120001",
      }),
    ]);

    expect(res.status).toBe(200);
    expect(((await res.json()) as ImportSuccessBody).imported).toBe(1);

    const [stay] = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.property_id, property.id));

    expect(stay?.check_in.toISOString()).toBe("2030-07-10T17:00:00.000Z");
    expect(stay?.check_out.toISOString()).toBe("2030-07-15T14:00:00.000Z");

    expect(renderedIn(stay!.check_in, "America/Sao_Paulo")).toBe("10/07/2030");
    expect(renderedIn(stay!.check_out, "America/Sao_Paulo")).toBe("15/07/2030");
  });

  it("writes the ledger description and date on the imported check-in day, not the day before", async () => {
    const { property, token } = await ownerInSaoPaulo(
      "import-dates-ledger@sogio.dev"
    );

    await importCsv(token, [
      stayRow({
        propertyId: property.id,
        checkIn: "10/07/2030",
        checkOut: "15/07/2030",
        phone: "5511911120002",
      }),
    ]);

    const [entry] = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));

    expect(entry?.description).toBe(
      "Pagamento de estadia: Mariana Ribeiro (10/07/2030 a 15/07/2030)"
    );
    expect(renderedIn(entry!.created_at, "America/Sao_Paulo")).toBe(
      "10/07/2030"
    );
  });

  it("uses the property's configured check times when they exist", async () => {
    const { property, token } = await ownerInSaoPaulo(
      "import-dates-configured@sogio.dev"
    );
    await setCheckTime(property.id, "check_in_time", "16:30");
    await setCheckTime(property.id, "check_out_time", "09:00");

    await importCsv(token, [
      stayRow({
        propertyId: property.id,
        checkIn: "2030-07-10",
        checkOut: "2030-07-15",
        phone: "5511911120003",
      }),
    ]);

    const [stay] = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.property_id, property.id));

    expect(stay?.check_in.toISOString()).toBe("2030-07-10T19:30:00.000Z");
    expect(stay?.check_out.toISOString()).toBe("2030-07-15T12:00:00.000Z");
  });

  it("falls back to the default check times when the setting is unparseable", async () => {
    const { property, token } = await ownerInSaoPaulo(
      "import-dates-broken-setting@sogio.dev"
    );
    await setCheckTime(property.id, "check_in_time", "quatro da tarde");
    await setCheckTime(property.id, "check_out_time", 11);

    const res = await importCsv(token, [
      stayRow({
        propertyId: property.id,
        checkIn: "2030-07-10",
        checkOut: "2030-07-15",
        phone: "5511911120004",
      }),
    ]);

    expect(res.status).toBe(200);

    const [stay] = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.property_id, property.id));

    expect(stay?.check_in.toISOString()).toBe("2030-07-10T17:00:00.000Z");
    expect(stay?.check_out.toISOString()).toBe("2030-07-15T14:00:00.000Z");
  });

  it("follows the owner's time zone, not the server's", async () => {
    const { user, property, token } = await ownerInSaoPaulo(
      "import-dates-other-zone@sogio.dev"
    );
    await setTimeZone(user.id, "Asia/Tokyo");

    await importCsv(token, [
      stayRow({
        propertyId: property.id,
        checkIn: "2030-07-10",
        checkOut: "2030-07-15",
        phone: "5511911120005",
      }),
    ]);

    const [stay] = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.property_id, property.id));

    expect(stay?.check_in.toISOString()).toBe("2030-07-10T05:00:00.000Z");
    expect(renderedIn(stay!.check_in, "Asia/Tokyo")).toBe("10/07/2030");
  });

  it("accepts a same-day turnover, because check-out precedes check-in", async () => {
    const { property, token } = await ownerInSaoPaulo(
      "import-dates-turnover@sogio.dev"
    );

    const res = await importCsv(token, [
      stayRow({
        propertyId: property.id,
        checkIn: "2030-07-10",
        checkOut: "2030-07-15",
        phone: "5511911120006",
      }),
      stayRow({
        propertyId: property.id,
        checkIn: "2030-07-15",
        checkOut: "2030-07-20",
        phone: "5511911120007",
        name: "Carlos Dias",
      }),
    ]);

    expect(res.status).toBe(200);
    expect(((await res.json()) as ImportSuccessBody).imported).toBe(2);
  });

  it("rejects a same-day turnover when the property's check-out is later than its check-in", async () => {
    const { property, token } = await ownerInSaoPaulo(
      "import-dates-turnover-conflict@sogio.dev"
    );
    await setCheckTime(property.id, "check_in_time", "09:00");
    await setCheckTime(property.id, "check_out_time", "18:00");

    const res = await importCsv(token, [
      stayRow({
        propertyId: property.id,
        checkIn: "2030-07-10",
        checkOut: "2030-07-15",
        phone: "5511911120008",
      }),
      stayRow({
        propertyId: property.id,
        checkIn: "2030-07-15",
        checkOut: "2030-07-20",
        phone: "5511911120009",
        name: "Carlos Dias",
      }),
    ]);

    expect(res.status).toBe(422);

    const body = (await res.json()) as ImportFailureBody;
    expect(body.failures[0]?.row).toBe(3);

    const stays = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.property_id, property.id));
    expect(stays).toHaveLength(0);
  });

  it.each(["UTC", "America/Sao_Paulo", "Asia/Tokyo"])(
    "stores the same instant no matter which time zone the server runs in (%s)",
    async processTimeZone => {
      const originalTimeZone = process.env.TZ;
      process.env.TZ = processTimeZone;

      try {
        const { property, token } = await ownerInSaoPaulo(
          `import-dates-server-${processTimeZone.replace(/\W/g, "-")}@sogio.dev`
        );

        await importCsv(token, [
          stayRow({
            propertyId: property.id,
            checkIn: "2030-07-10",
            checkOut: "2030-07-15",
            phone: "5511911120011",
          }),
        ]);

        const [stay] = await db
          .select()
          .from(staysTable)
          .where(eq(staysTable.property_id, property.id));

        expect(stay?.check_in.toISOString()).toBe("2030-07-10T17:00:00.000Z");
        expect(stay?.check_out.toISOString()).toBe("2030-07-15T14:00:00.000Z");
      } finally {
        process.env.TZ = originalTimeZone;
      }
    }
  );

  it("still rejects a check-out on the same calendar day as the check-in", async () => {
    const { property, token } = await ownerInSaoPaulo(
      "import-dates-same-day@sogio.dev"
    );

    const res = await importCsv(token, [
      stayRow({
        propertyId: property.id,
        checkIn: "2030-07-10",
        checkOut: "2030-07-10",
        phone: "5511911120010",
      }),
    ]);

    expect(res.status).toBe(422);

    const body = (await res.json()) as ImportFailureBody;
    expect(body.failures[0]?.field).toBe("check_in");
    expect(body.failures[0]?.message).toBe("check_in must be before check_out");
  });
});

describe("property_settings", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("accepts check_in_time and check_out_time as setting keys", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-dates-setting-keys@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    await setCheckTime(property.id, "check_in_time", "14:00");
    await setCheckTime(property.id, "check_out_time", "11:00");

    const settings = await db
      .select()
      .from(propertySettingsTable)
      .where(eq(propertySettingsTable.property_id, property.id));

    expect(settings.map(setting => setting.key).sort()).toEqual([
      "check_in_time",
      "check_out_time",
    ]);
  });
});
