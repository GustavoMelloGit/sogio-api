import { describe, it, expect, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { db } from "../../src/core/infra/database/drizzle/database";
import {
  ledgerEntriesTable,
  usersTable,
} from "../../src/core/infra/database/drizzle/schema";

const TABLES = [
  "stays",
  "tenants",
  "ledger_entries",
  "properties",
  "addresses",
  "users",
];

async function bookStay(
  token: string,
  propertyId: string,
  period: { check_in: string; check_out: string },
  tenantName = "Ana Souza"
): Promise<Response> {
  return api(`/booking/property/${propertyId}/book`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: JSON.stringify({
      guests: 2,
      check_in: period.check_in,
      check_out: period.check_out,
      price: 10000,
      source: "DIRECT",
      tenant: { name: tenantName, phone: "5511999990001", sex: "FEMALE" },
    }),
  });
}

async function ownerWithProperty(preferences?: {
  locale: string;
  time_zone: string;
}) {
  const { user } = await createUserFixture({
    name: "João Silva",
    email: "joao@sogio.dev",
    password: "password123",
  });

  if (preferences) {
    await db
      .update(usersTable)
      .set(preferences)
      .where(eq(usersTable.id, user.id));
  }

  const property = await createPropertyFixture({ userId: user.id });
  const token = await createAuthToken(user.id);

  return { property, token };
}

async function ledgerFor(propertyId: string) {
  return db
    .select()
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.property_id, propertyId));
}

type LedgerRow = { amount: number | string; description: string | null };

function descriptionsOf(entries: LedgerRow[], kind: "revenue" | "expense") {
  const matches = entries.filter(entry =>
    kind === "revenue" ? Number(entry.amount) > 0 : Number(entry.amount) < 0
  );

  expect(matches.length).toBeGreaterThan(0);

  return [...new Set(matches.map(entry => entry.description))];
}

describe("Ledger descriptions for stay revenue and cancellation", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("names the tenant and the stay period on the revenue entry", async () => {
    const { property, token } = await ownerWithProperty();

    const bookRes = await bookStay(token, property.id, {
      check_in: "2040-06-01T12:00:00.000Z",
      check_out: "2040-06-03T12:00:00.000Z",
    });
    expect(bookRes.status).toBe(200);

    const entries = await ledgerFor(property.id);
    expect(descriptionsOf(entries, "revenue")).toEqual([
      "Pagamento de estadia: Ana Souza (01/06/2040 a 03/06/2040)",
    ]);
  });

  it("names the tenant and the stay period on the cancellation entry", async () => {
    const { property, token } = await ownerWithProperty();

    const bookRes = await bookStay(token, property.id, {
      check_in: "2040-06-01T12:00:00.000Z",
      check_out: "2040-06-03T12:00:00.000Z",
    });
    const bookBody = (await bookRes.json()) as { data: { id: string } };

    const res = await api(`/booking/stay/${bookBody.data.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    expect(res.status).toBe(200);

    const entries = await ledgerFor(property.id);
    expect(descriptionsOf(entries, "expense")).toEqual([
      "Estadia cancelada: Ana Souza (01/06/2040 a 03/06/2040)",
    ]);
  });

  it("names the tenant on stays canceled in cascade by a property deletion", async () => {
    const { property, token } = await ownerWithProperty();

    const bookRes = await bookStay(
      token,
      property.id,
      {
        check_in: "2040-06-01T12:00:00.000Z",
        check_out: "2040-06-03T12:00:00.000Z",
      },
      "Carlos Lima"
    );
    expect(bookRes.status).toBe(200);

    const res = await api(`/property/${property.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    expect(res.status).toBe(200);

    const entries = await ledgerFor(property.id);
    expect(descriptionsOf(entries, "expense")).toEqual([
      "Estadia cancelada: Carlos Lima (01/06/2040 a 03/06/2040)",
    ]);
  });

  it("renders the period in America/Sao_Paulo, not UTC", async () => {
    const { property, token } = await ownerWithProperty();

    const bookRes = await bookStay(token, property.id, {
      check_in: "2040-06-01T02:00:00.000Z",
      check_out: "2040-06-03T02:00:00.000Z",
    });
    expect(bookRes.status).toBe(200);

    const entries = await ledgerFor(property.id);
    expect(descriptionsOf(entries, "revenue")).toEqual([
      "Pagamento de estadia: Ana Souza (31/05/2040 a 02/06/2040)",
    ]);
  });

  it("writes the entry in the language and time zone the owner chose", async () => {
    const { property, token } = await ownerWithProperty({
      locale: "en-US",
      time_zone: "America/New_York",
    });

    const bookRes = await bookStay(token, property.id, {
      check_in: "2040-06-01T12:00:00.000Z",
      check_out: "2040-06-03T02:00:00.000Z",
    });
    expect(bookRes.status).toBe(200);

    const entries = await ledgerFor(property.id);
    expect(descriptionsOf(entries, "revenue")).toEqual([
      "Stay payment: Ana Souza (06/01/2040 to 06/02/2040)",
    ]);
  });

  it("writes the cancellation entry in the owner's language too", async () => {
    const { property, token } = await ownerWithProperty({
      locale: "en-US",
      time_zone: "America/Sao_Paulo",
    });

    const bookRes = await bookStay(token, property.id, {
      check_in: "2040-06-01T12:00:00.000Z",
      check_out: "2040-06-03T12:00:00.000Z",
    });
    const bookBody = (await bookRes.json()) as { data: { id: string } };

    const res = await api(`/booking/stay/${bookBody.data.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    expect(res.status).toBe(200);

    const entries = await ledgerFor(property.id);
    expect(descriptionsOf(entries, "expense")).toEqual([
      "Stay canceled: Ana Souza (06/01/2040 to 06/03/2040)",
    ]);
  });
});
