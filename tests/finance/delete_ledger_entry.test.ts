import { describe, it, expect, beforeEach } from "bun:test";
import { and, eq } from "drizzle-orm";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { db } from "../../src/core/infra/database/drizzle/database";
import {
  ledgerEntriesTable,
  staysTable,
} from "../../src/core/infra/database/drizzle/schema";
import { LedgerEntryPostgresRepository } from "../../src/finance/infra/database/postgres_repository/ledger_entry_postgres_repository";

const TABLES = [
  "stays",
  "tenants",
  "ledger_entries",
  "properties",
  "addresses",
  "users",
];

type BookStayBody = { data: { id: string } };
type MovementsBody = { data: Array<{ id: string }> };

async function recordExpense(
  token: string,
  propertyId: string,
  amount: number
): Promise<string> {
  const res = await api(`/finance/${propertyId}/expense`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: JSON.stringify({
      amount,
      description: "Despesa de teste",
      category: "MANUTENÇÃO",
    }),
  });
  expect(res.status).toBe(204);

  const rows = await db
    .select()
    .from(ledgerEntriesTable)
    .where(
      and(
        eq(ledgerEntriesTable.property_id, propertyId),
        eq(ledgerEntriesTable.amount, -amount)
      )
    );
  const entry = rows[0];
  if (!entry) {
    throw new Error("Failed to create ledger entry fixture");
  }
  return entry.id;
}

async function bookStay(
  token: string,
  propertyId: string,
  period: { check_in: string; check_out: string }
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
      tenant: { name: "Ana Souza", phone: "5511999990002", sex: "FEMALE" },
    }),
  });
}

describe("DELETE /finance/properties/:property_id/movements/:entry_id", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("204 — soft-deletes a ledger entry owned by the user", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "delete-happy@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);
    const entryId = await recordExpense(token, property.id, 5000);

    const res = await api(
      `/finance/properties/${property.id}/movements/${entryId}`,
      { method: "DELETE", headers: { Authorization: "Bearer " + token } }
    );

    expect(res.status).toBe(204);
  });

  it("404 — rejects a ledger entry belonging to another user's property", async () => {
    const { user: owner } = await createUserFixture({
      name: "João Silva",
      email: "delete-owner@sogio.dev",
      password: "password123",
    });
    const { user: intruder } = await createUserFixture({
      name: "Maria Souza",
      email: "delete-intruder@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: owner.id });
    const ownerToken = await createAuthToken(owner.id);
    const intruderToken = await createAuthToken(intruder.id);
    const entryId = await recordExpense(ownerToken, property.id, 5000);

    const res = await api(
      `/finance/properties/${property.id}/movements/${entryId}`,
      {
        method: "DELETE",
        headers: { Authorization: "Bearer " + intruderToken },
      }
    );

    expect(res.status).toBe(404);

    const rows = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.id, entryId));
    expect(rows[0]?.deleted_at).toBeNull();
  });

  it("404 — a second deletion of the same entry is not found", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "delete-twice@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);
    const entryId = await recordExpense(token, property.id, 5000);

    const firstRes = await api(
      `/finance/properties/${property.id}/movements/${entryId}`,
      { method: "DELETE", headers: { Authorization: "Bearer " + token } }
    );
    expect(firstRes.status).toBe(204);

    const secondRes = await api(
      `/finance/properties/${property.id}/movements/${entryId}`,
      { method: "DELETE", headers: { Authorization: "Bearer " + token } }
    );
    expect(secondRes.status).toBe(404);
  });

  /**
   * R-9: the property's balance and its movement listing must both stop
   * counting a deleted entry. Without this test, a regression could turn the
   * soft delete into a no-op that only hides the row from one of the two
   * reads while it keeps affecting the other silently.
   */
  it("R-9 — after deletion, both the property balance and the movement listing ignore the entry", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "delete-r9@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const survivingEntryId = await recordExpense(token, property.id, 3000);
    const doomedEntryId = await recordExpense(token, property.id, 5000);

    const ledgerEntryRepository = new LedgerEntryPostgresRepository();
    const balanceBefore = await ledgerEntryRepository.propertyBalance(
      property.id
    );
    expect(balanceBefore).toBe(-8000);

    const res = await api(
      `/finance/properties/${property.id}/movements/${doomedEntryId}`,
      { method: "DELETE", headers: { Authorization: "Bearer " + token } }
    );
    expect(res.status).toBe(204);

    const balanceAfter = await ledgerEntryRepository.propertyBalance(
      property.id
    );
    expect(balanceAfter).toBe(-3000);

    const movementsRes = await api(
      `/finance/properties/${property.id}/movements`,
      { headers: { Authorization: "Bearer " + token } }
    );
    const body = (await movementsRes.json()) as MovementsBody;

    expect(body.data.map(entry => entry.id)).toEqual([survivingEntryId]);
    expect(body.data.map(entry => entry.id)).not.toContain(doomedEntryId);
  });

  /**
   * IM-7: cancellation and deletion are distinct mechanisms and neither
   * substitutes the other. Canceling a stay must keep generating a
   * counter-entry (a new, negative-signed row) and must never mark the
   * original revenue entry's `deleted_at` — that would erase the fact that
   * the stay happened at all.
   */
  it("IM-7 — canceling a stay still reverses revenue with a counter-entry, never deleting the original", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "delete-im7@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const bookRes = await bookStay(token, property.id, {
      check_in: "2040-06-01T12:00:00.000Z",
      check_out: "2040-06-03T12:00:00.000Z",
    });
    expect(bookRes.status).toBe(200);
    const bookBody = (await bookRes.json()) as BookStayBody;

    const revenueRows = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));
    expect(revenueRows).toHaveLength(1);
    const originalRevenueId = revenueRows[0]?.id;
    expect(originalRevenueId).toBeDefined();

    const cancelRes = await api(`/booking/stay/${bookBody.data.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    expect(cancelRes.status).toBe(200);

    const stayRows = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.id, bookBody.data.id));
    expect(stayRows[0]?.deleted_at).not.toBeNull();

    const ledgerRows = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));

    expect(ledgerRows).toHaveLength(2);

    const originalEntry = ledgerRows.find(row => row.id === originalRevenueId);
    expect(originalEntry).toBeDefined();
    expect(originalEntry?.deleted_at).toBeNull();
    expect(Number(originalEntry?.amount)).toBeGreaterThan(0);

    const counterEntry = ledgerRows.find(row => row.id !== originalRevenueId);
    expect(counterEntry).toBeDefined();
    expect(Number(counterEntry?.amount)).toBeLessThan(0);
    expect(counterEntry?.deleted_at).toBeNull();
  });
});
