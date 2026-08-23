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
  usersTable,
} from "../../src/core/infra/database/drizzle/schema";

const TABLES = [
  "ledger_entries",
  "stays",
  "tenants",
  "properties",
  "addresses",
  "users",
];

const HEADER = "property_id,kind,amount,category,description,occurred_at";

async function ownerIn(email: string, timeZone: string) {
  const { user } = await createUserFixture({
    name: "João Silva",
    email,
    password: "password123",
  });
  await upgradeToPro(user.id);
  await db
    .update(usersTable)
    .set({ time_zone: timeZone })
    .where(eq(usersTable.id, user.id));
  const property = await createPropertyFixture({ userId: user.id });
  const token = await createAuthToken(user.id);

  return { user, property, token };
}

async function importCsv(token: string, rows: string[]): Promise<Response> {
  return api("/import/ledger-entries", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "text/csv" },
    body: [HEADER, ...rows].join("\n"),
  });
}

function renderedIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone }).format(instant);
}

describe("POST /import/ledger-entries — occurred_at is the start of the day in the owner's time zone", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("keeps an imported movement on the day the owner typed", async () => {
    const { property, token } = await ownerIn(
      "import-ledger-dates-sp@sogio.dev",
      "America/Sao_Paulo"
    );

    const res = await importCsv(token, [
      [
        property.id,
        "expense",
        "5000",
        "MANUTENÇÃO",
        "Faxina",
        "2030-07-10",
      ].join(","),
    ]);

    expect(res.status).toBe(200);

    const [entry] = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));

    expect(entry?.created_at.toISOString()).toBe("2030-07-10T03:00:00.000Z");
    expect(renderedIn(entry!.created_at, "America/Sao_Paulo")).toBe(
      "10/07/2030"
    );
  });

  it("follows the owner's time zone, not the server's", async () => {
    const { property, token } = await ownerIn(
      "import-ledger-dates-tokyo@sogio.dev",
      "Asia/Tokyo"
    );

    await importCsv(token, [
      [property.id, "revenue", "9000", "EXTRA", "Taxa", "10/07/2030"].join(","),
    ]);

    const [entry] = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));

    expect(entry?.created_at.toISOString()).toBe("2030-07-09T15:00:00.000Z");
    expect(renderedIn(entry!.created_at, "Asia/Tokyo")).toBe("10/07/2030");
  });

  it.each(["UTC", "America/Sao_Paulo", "Asia/Tokyo"])(
    "stores the same instant no matter which time zone the server runs in (%s)",
    async processTimeZone => {
      const originalTimeZone = process.env.TZ;
      process.env.TZ = processTimeZone;

      try {
        const { property, token } = await ownerIn(
          `import-ledger-server-${processTimeZone.replace(/\W/g, "-")}@sogio.dev`,
          "America/Sao_Paulo"
        );

        await importCsv(token, [
          [
            property.id,
            "expense",
            "5000",
            "MANUTENÇÃO",
            "Faxina",
            "2030-07-10",
          ].join(","),
        ]);

        const [entry] = await db
          .select()
          .from(ledgerEntriesTable)
          .where(eq(ledgerEntriesTable.property_id, property.id));

        expect(entry?.created_at.toISOString()).toBe(
          "2030-07-10T03:00:00.000Z"
        );
      } finally {
        process.env.TZ = originalTimeZone;
      }
    }
  );

  it("still rejects an unparseable date", async () => {
    const { property, token } = await ownerIn(
      "import-ledger-dates-invalid@sogio.dev",
      "America/Sao_Paulo"
    );

    const res = await importCsv(token, [
      [
        property.id,
        "expense",
        "5000",
        "MANUTENÇÃO",
        "Faxina",
        "2030-02-30",
      ].join(","),
    ]);

    expect(res.status).toBe(422);

    const body = (await res.json()) as {
      failures: Array<{ field: string | null }>;
    };
    expect(body.failures[0]?.field).toBe("occurred_at");
  });
});
