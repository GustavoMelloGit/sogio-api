import { describe, it, expect, beforeEach, spyOn } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { db } from "../../src/core/infra/database/drizzle/database";
import {
  ledgerEntriesTable,
  staysTable,
  tenantsTable,
} from "../../src/core/infra/database/drizzle/schema";
import { inMemoryEventDispatcher } from "../../src/core/infra/event/in_memory_event_dispatcher";

const TABLES = [
  "ledger_entries",
  "stays",
  "tenants",
  "properties",
  "addresses",
  "users",
];

type ImportSuccessBody = { imported: number };
type ImportFailureBody = {
  message: string;
  failures: Array<{ row: number; field: string | null; message: string }>;
  truncated: boolean;
};

async function importCsv(token: string, csv: string): Promise<Response> {
  return api("/import/stays", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "text/csv" },
    body: csv,
  });
}

const HEADER =
  "property_id,check_in,check_out,guests,price,source,tenant_name,tenant_phone,tenant_sex";

function stayRow(fields: {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  price: number;
  phone: string;
  name?: string;
}): string {
  return [
    fields.propertyId,
    fields.checkIn,
    fields.checkOut,
    "2",
    String(fields.price),
    "AIRBNB",
    fields.name ?? "Hóspede Teste",
    fields.phone,
    "FEMALE",
  ].join(",");
}

describe("POST /import/stays", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("200 — accepts a batch, creates the stays, their revenue in the ledger, and never calls the door lock (IM-4)", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-stays-happy@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const dispatchSpy = spyOn(inMemoryEventDispatcher, "dispatch");

    const csv = [
      HEADER,
      stayRow({
        propertyId: property.id,
        checkIn: "2030-01-10",
        checkOut: "2030-01-15",
        price: 100000,
        phone: "5511911110001",
      }),
      stayRow({
        propertyId: property.id,
        checkIn: "2030-02-10",
        checkOut: "2030-02-15",
        price: 200000,
        phone: "5511911110002",
      }),
    ].join("\n");

    const res = await importCsv(token, csv);

    const dispatchedEventNames = dispatchSpy.mock.calls.map(
      ([event]) => event.name
    );
    dispatchSpy.mockRestore();

    expect(res.status).toBe(200);
    expect(dispatchedEventNames).toContain("stay_imported");
    expect(dispatchedEventNames).not.toContain("stay_booked");

    const body = (await res.json()) as ImportSuccessBody;
    expect(body.imported).toBe(2);

    const stays = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.property_id, property.id));
    expect(stays).toHaveLength(2);

    const entries = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));
    expect(entries).toHaveLength(2);
    expect(entries.every(entry => entry.category === "ESTADIA")).toBe(true);
    expect(entries.some(entry => Number(entry.amount) === 100000)).toBe(true);
    expect(entries.some(entry => Number(entry.amount) === 200000)).toBe(true);

    const firstEntry = entries.find(entry => Number(entry.amount) === 100000);
    expect(firstEntry?.created_at.toISOString().slice(0, 10)).toBe(
      "2030-01-10"
    );
  });

  it("422 — IM-3: two stays overlapping each other in the same file are both rejected", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-stays-overlap-batch@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const csv = [
      HEADER,
      stayRow({
        propertyId: property.id,
        checkIn: "2031-01-10",
        checkOut: "2031-01-15",
        price: 100000,
        phone: "5511911110003",
      }),
      stayRow({
        propertyId: property.id,
        checkIn: "2031-01-12",
        checkOut: "2031-01-20",
        price: 100000,
        phone: "5511911110004",
      }),
    ].join("\n");

    const res = await importCsv(token, csv);
    const body = (await res.json()) as ImportFailureBody;

    expect(res.status).toBe(422);
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]?.row).toBe(3);
    expect(body.failures[0]?.message).toBe("Property is occupied");

    const stays = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.property_id, property.id));
    expect(stays).toHaveLength(0);
  });

  it("200 — IM-3: ten stays for the same phone create a single tenant", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-stays-same-tenant@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);
    const phone = "5511922220000";

    const rows = Array.from({ length: 10 }, (_, index) => {
      const month = String(index + 1).padStart(2, "0");
      return stayRow({
        propertyId: property.id,
        checkIn: `2032-${month}-01`,
        checkOut: `2032-${month}-03`,
        price: 50000,
        phone,
      });
    });

    const res = await importCsv(token, [HEADER, ...rows].join("\n"));
    const body = (await res.json()) as ImportSuccessBody;

    expect(res.status).toBe(200);
    expect(body.imported).toBe(10);

    const tenants = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.phone, phone));
    expect(tenants).toHaveLength(1);
  });

  it("422 — IM-5: tenants created before a late failure do not survive the rejected batch", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-stays-im5@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const phones = ["5511933330001", "5511933330002", "5511933330003"];

    const csv = [
      HEADER,
      stayRow({
        propertyId: property.id,
        checkIn: "2033-03-01",
        checkOut: "2033-03-05",
        price: 50000,
        phone: phones[0]!,
      }),
      stayRow({
        propertyId: property.id,
        checkIn: "2033-04-01",
        checkOut: "2033-04-05",
        price: 50000,
        phone: phones[1]!,
      }),
      stayRow({
        propertyId: property.id,
        checkIn: "2033-05-01",
        checkOut: "2033-05-05",
        price: 50000,
        phone: phones[2]!,
      }),
      stayRow({
        propertyId: property.id,
        checkIn: "2033-03-04",
        checkOut: "2033-03-08",
        price: 50000,
        phone: "5511933330004",
      }),
    ].join("\n");

    const res = await importCsv(token, csv);
    const body = (await res.json()) as ImportFailureBody;

    expect(res.status).toBe(422);
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]?.row).toBe(5);

    const stays = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.property_id, property.id));
    expect(stays).toHaveLength(0);

    const tenants = await db
      .select()
      .from(tenantsTable)
      .where(inArray(tenantsTable.phone, phones));
    expect(tenants).toHaveLength(0);
  });

  it("422 — IM-2: overlap with an already-existing stay is a row-level failure, not a bare 409", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-stays-existing-overlap@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const bookRes = await api(`/booking/property/${property.id}/book`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({
        guests: 2,
        check_in: "2034-05-10T12:00:00.000Z",
        check_out: "2034-05-15T12:00:00.000Z",
        price: 90000,
        source: "DIRECT",
        tenant: {
          name: "Hóspede Existente",
          phone: "5511944440000",
          sex: "FEMALE",
        },
      }),
    });
    expect(bookRes.status).toBe(200);

    const csv = [
      HEADER,
      stayRow({
        propertyId: property.id,
        checkIn: "2034-05-14",
        checkOut: "2034-05-18",
        price: 100000,
        phone: "5511944440001",
      }),
    ].join("\n");

    const res = await importCsv(token, csv);
    const body = (await res.json()) as ImportFailureBody;

    expect(res.status).toBe(422);
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]?.row).toBe(2);
    expect(body.failures[0]?.message).toBe("Property is occupied");

    const stays = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.property_id, property.id));
    expect(stays).toHaveLength(1);
  });
});
