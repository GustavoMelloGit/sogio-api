import { describe, it, expect, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { upgradeToPro } from "../helpers/fixtures/plan";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { db } from "../../src/core/infra/database/drizzle/database";
import { ledgerEntriesTable } from "../../src/core/infra/database/drizzle/schema";

const TABLES = ["ledger_entries", "properties", "addresses", "users"];

type ImportSuccessBody = { imported: number };
type ImportFailureBody = {
  message: string;
  failures: Array<{ row: number; field: string | null; message: string }>;
  truncated: boolean;
};
type MovementsBody = {
  data: Array<{ id: string; created_at: string; property_id: string }>;
};

async function importCsv(token: string, csv: string): Promise<Response> {
  return api("/import/ledger-entries", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "text/csv" },
    body: csv,
  });
}

describe("POST /import/ledger-entries", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("200 — accepts a batch and writes every row", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-happy@sogio.dev",
      password: "password123",
    });
    await upgradeToPro(user.id);
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const csv = [
      "property_id,kind,amount,category,description,occurred_at",
      `${property.id},expense,15000,MANUTENÇÃO,Reparo no encanamento,`,
      `${property.id},revenue,120000,ESTADIA,Pagamento da hospedagem,`,
    ].join("\n");

    const res = await importCsv(token, csv);
    const body = (await res.json()) as ImportSuccessBody;

    expect(res.status).toBe(200);
    expect(body.imported).toBe(2);

    const rows = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));

    expect(rows).toHaveLength(2);
    expect(rows.some(row => Number(row.amount) === -15000)).toBe(true);
    expect(rows.some(row => Number(row.amount) === 120000)).toBe(true);
  });

  it("422 — rejects a batch with invalid rows, one failure per invalid row, and writes nothing", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-rejected@sogio.dev",
      password: "password123",
    });
    await upgradeToPro(user.id);
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const csv = [
      "property_id,kind,amount,category,description,occurred_at",
      `${property.id},expense,15000,MANUTENÇÃO,,`,
      `${property.id},expense,-500,MANUTENÇÃO,,`,
      `${property.id},expense,3000,CATEGORIA_INVALIDA,,`,
    ].join("\n");

    const res = await importCsv(token, csv);
    const body = (await res.json()) as ImportFailureBody;

    expect(res.status).toBe(422);
    expect(body.failures).toHaveLength(2);
    expect(body.failures.map(failure => failure.row)).toEqual([3, 4]);
    expect(body.truncated).toBe(false);

    const rows = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));
    expect(rows).toHaveLength(0);
  });

  it("422 — a property_id belonging to another user is a row-level failure, not a bare 404", async () => {
    const { user: owner } = await createUserFixture({
      name: "João Silva",
      email: "import-owner@sogio.dev",
      password: "password123",
    });
    await upgradeToPro(owner.id);
    const { user: intruder } = await createUserFixture({
      name: "Maria Souza",
      email: "import-intruder@sogio.dev",
      password: "password123",
    });
    await upgradeToPro(intruder.id);
    const ownedProperty = await createPropertyFixture({ userId: owner.id });
    const intruderToken = await createAuthToken(intruder.id);

    const csv = [
      "property_id,kind,amount,category,description,occurred_at",
      `${ownedProperty.id},expense,15000,MANUTENÇÃO,,`,
    ].join("\n");

    const res = await importCsv(intruderToken, csv);
    const body = (await res.json()) as ImportFailureBody;

    expect(res.status).toBe(422);
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]?.field).toBe("property_id");

    const rows = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, ownedProperty.id));
    expect(rows).toHaveLength(0);
  });

  it("IM-6 — a historical occurred_at is reflected by find_property_financial_movements", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-historical@sogio.dev",
      password: "password123",
    });
    await upgradeToPro(user.id);
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const csv = [
      "property_id,kind,amount,category,description,occurred_at",
      `${property.id},expense,15000,MANUTENÇÃO,Conserto antigo,15/01/2026`,
    ].join("\n");

    const importRes = await importCsv(token, csv);
    expect(importRes.status).toBe(200);

    const movementsRes = await api(
      `/finance/properties/${property.id}/movements`,
      { headers: { Authorization: "Bearer " + token } }
    );
    const body = (await movementsRes.json()) as MovementsBody;

    expect(movementsRes.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.created_at.slice(0, 10)).toBe("2026-01-15");
  });

  it("IM-5 — a failure on the last row of a longer batch leaves no trace of the previous rows", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-im5@sogio.dev",
      password: "password123",
    });
    await upgradeToPro(user.id);
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const csv = [
      "property_id,kind,amount,category,description,occurred_at",
      `${property.id},expense,1000,MANUTENÇÃO,,`,
      `${property.id},revenue,2000,ESTADIA,,`,
      `${property.id},expense,3000,GASTOS_FIXOS,,`,
      `${property.id},expense,-1,MANUTENÇÃO,,`,
    ].join("\n");

    const res = await importCsv(token, csv);
    const body = (await res.json()) as ImportFailureBody;

    expect(res.status).toBe(422);
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]?.row).toBe(5);

    const rows = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));
    expect(rows).toHaveLength(0);
  });

  it("401 — rejects request without auth token", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "import-unauth@sogio.dev",
      password: "password123",
    });
    await upgradeToPro(user.id);
    const property = await createPropertyFixture({ userId: user.id });

    const csv = [
      "property_id,kind,amount,category,description,occurred_at",
      `${property.id},expense,15000,MANUTENÇÃO,,`,
    ].join("\n");

    const res = await api("/import/ledger-entries", {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: csv,
    });

    expect(res.status).toBe(401);
  });
});
