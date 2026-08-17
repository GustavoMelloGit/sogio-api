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
  staysTable,
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
      tenant: { name: "Ana Souza", phone: "5511999990001", sex: "FEMALE" },
    }),
  });
}

/**
 * Regression coverage for `DELETE /booking/stay/:stay_id` after extracting
 * `CancelStayService` out of `CancelStayUseCase` (task 12, DA-3-R): the HTTP
 * route's behavior must be unaffected by the refactor. Before this file, the
 * only end-to-end coverage of `CancelStayUseCase` went through the MCP tool
 * (`cancel_stay_tool.test.ts`), never through the HTTP route itself.
 */
describe("DELETE /booking/stay/:stay_id", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("cancels a future stay and reverses its revenue in the ledger", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const bookRes = await bookStay(token, property.id, {
      check_in: "2040-06-01T12:00:00.000Z",
      check_out: "2040-06-03T12:00:00.000Z",
    });
    expect(bookRes.status).toBe(200);
    const bookBody = (await bookRes.json()) as { data: { id: string } };

    const res = await api(`/booking/stay/${bookBody.data.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; cancelled_at: string };
    expect(body.id).toBe(bookBody.data.id);
    expect(body.cancelled_at).toBeDefined();

    const stayRows = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.id, bookBody.data.id));
    expect(stayRows[0]?.deleted_at).not.toBeNull();

    const ledgerRows = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));
    // One entry for the original booking revenue, one for the reversal.
    expect(ledgerRows).toHaveLength(2);
    expect(ledgerRows.some(row => Number(row.amount) < 0)).toBe(true);
  });

  it("404s for a stay on another user's property, never distinguishing it from a nonexistent one", async () => {
    const { user: owner } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const { user: intruder } = await createUserFixture({
      name: "Maria Souza",
      email: "maria@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: owner.id });
    const ownerToken = await createAuthToken(owner.id);
    const intruderToken = await createAuthToken(intruder.id);

    const bookRes = await bookStay(ownerToken, property.id, {
      check_in: "2040-06-01T12:00:00.000Z",
      check_out: "2040-06-03T12:00:00.000Z",
    });
    const bookBody = (await bookRes.json()) as { data: { id: string } };

    const res = await api(`/booking/stay/${bookBody.data.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + intruderToken },
    });

    expect(res.status).toBe(404);

    const stayRows = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.id, bookBody.data.id));
    expect(stayRows[0]?.deleted_at).toBeNull();
  });
});
