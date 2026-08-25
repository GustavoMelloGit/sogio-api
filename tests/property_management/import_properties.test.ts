import { describe, it, expect, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import {
  PRO_PLAN_ID,
  assignPlanWithCapabilities,
} from "../helpers/fixtures/plan";
import { db } from "../../src/core/infra/database/drizzle/database";
import {
  propertiesTable,
  subscriptionsTable,
} from "../../src/core/infra/database/drizzle/schema";
import { makeConnectionSurvivalProbeStream } from "../helpers/paced_stream";

const TABLES = ["properties", "addresses", "users"];

const HEADER =
  "name,capacity,street,number,neighborhood,city,state,zip_code,country,complement,images";

function propertyRow(name: string, capacity = 2): string {
  return [
    name,
    String(capacity),
    "Avenida Beira Mar",
    "1200",
    "Praia do Canto",
    "Vitória",
    "ES",
    "29055-000",
    "Brasil",
    "",
    "",
  ].join(",");
}

function buildCsv(rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

const HEADER_MISSING_COUNTRY =
  "name,capacity,street,number,neighborhood,city,state,zip_code";

function makePacedRejectedCsvStream(
  totalPaddingBytes: number,
  chunkBytes: number,
  delayMs: number
): ReadableStream<Uint8Array> {
  const { readable } = makeConnectionSurvivalProbeStream(
    totalPaddingBytes,
    chunkBytes,
    delayMs,
    {
      preamble: new TextEncoder().encode(HEADER_MISSING_COUNTRY + "\n"),
      fillByte: 120,
    }
  );
  return readable;
}

async function upgradeToPro(userId: string): Promise<void> {
  await db
    .update(subscriptionsTable)
    .set({ plan_id: PRO_PLAN_ID })
    .where(eq(subscriptionsTable.user_id, userId));
}

async function countPropertiesOfUser(userId: string): Promise<number> {
  const rows = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.user_id, userId));
  return rows.length;
}

describe("POST /import/properties", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("imports an accepted batch without an images column and persists the properties", async () => {
    const { user } = await createUserFixture({
      name: "Dono de Imóvel",
      email: "import.accepted@sogio.dev",
      password: "password123",
    });
    await upgradeToPro(user.id);
    const token = await createAuthToken(user.id);

    const csv = [
      "name,capacity,street,number,neighborhood,city,state,zip_code,country",
      "Apartamento Vista Mar,4,Avenida Beira Mar,1200,Praia do Canto,Vitória,ES,29055-000,Brasil",
      "Casa de Praia,2,Rua das Flores,10,Centro,São Paulo,SP,01310-100,Brasil",
    ].join("\n");

    const res = await api("/import/properties", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "text/csv",
      },
      body: csv,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { imported: number };
    expect(body.imported).toBe(2);

    const rows = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.user_id, user.id));
    const names = rows.map(row => row.name).sort();
    expect(names).toEqual(["Apartamento Vista Mar", "Casa de Praia"]);
    expect(rows.every(row => row.images.length === 0)).toBe(true);
  });

  it("rejects a batch that would exceed max_properties in its entirety, not truncated", async () => {
    const { user } = await createUserFixture({
      name: "Dono de Imóvel",
      email: "import.quota-batch@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);

    const csv = buildCsv([
      propertyRow("Casa 1"),
      propertyRow("Casa 2"),
      propertyRow("Casa 3"),
    ]);

    const res = await api("/import/properties", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "text/csv",
      },
      body: csv,
    });

    expect(res.status).toBe(403);
    expect(await countPropertiesOfUser(user.id)).toBe(0);
  });

  it("counts the batch's own inserts cumulatively against the quota (IM-3)", async () => {
    const { user } = await createUserFixture({
      name: "Dono de Imóvel",
      email: "import.quota-cumulative@sogio.dev",
      password: "password123",
    });
    await upgradeToPro(user.id);
    await createPropertyFixture({ userId: user.id, name: "Existente 1" });
    await createPropertyFixture({ userId: user.id, name: "Existente 2" });
    await createPropertyFixture({ userId: user.id, name: "Existente 3" });
    const token = await createAuthToken(user.id);

    const csv = buildCsv([
      propertyRow("Nova 1"),
      propertyRow("Nova 2"),
      propertyRow("Nova 3"),
    ]);

    const res = await api("/import/properties", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "text/csv",
      },
      body: csv,
    });

    expect(res.status).toBe(403);
    expect(await countPropertiesOfUser(user.id)).toBe(3);
  });

  it("403 — a plan without bulk_import cannot import at all", async () => {
    const { user } = await createUserFixture({
      name: "Dono de Imóvel",
      email: "import.no-capability@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);

    const res = await api("/import/properties", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "text/csv",
      },
      body: buildCsv([propertyRow("Casa Bloqueada")]),
    });
    const body = (await res.json()) as { message: string };

    expect(res.status).toBe(403);
    expect(body.message).toContain("bulk data imports");
    expect(await countPropertiesOfUser(user.id)).toBe(0);
  });

  it("produces the same upgrade message as the unit path when the quota is exceeded (IM-2)", async () => {
    const { user: unitPathUser } = await createUserFixture({
      name: "Dono de Imóvel",
      email: "import.im2-unit@sogio.dev",
      password: "password123",
    });
    await createPropertyFixture({ userId: unitPathUser.id });
    const unitPathToken = await createAuthToken(unitPathUser.id);

    const unitPathRes = await api("/property", {
      method: "POST",
      headers: { Authorization: "Bearer " + unitPathToken },
      body: JSON.stringify({
        name: "Segunda Casa",
        address: {
          street: "Rua X",
          number: "1",
          neighborhood: "Centro",
          city: "São Paulo",
          state: "SP",
          zip_code: "01310-100",
          country: "Brasil",
          complement: "",
        },
        images: [],
        capacity: 2,
      }),
    });
    expect(unitPathRes.status).toBe(403);
    const unitPathBody = (await unitPathRes.json()) as { message: string };

    const { user: importUser } = await createUserFixture({
      name: "Dono de Imóvel",
      email: "import.im2-batch@sogio.dev",
      password: "password123",
    });
    await createPropertyFixture({ userId: importUser.id });
    await assignPlanWithCapabilities(importUser.id, "import-im2-quota", {
      max_properties: 1,
      bulk_import: true,
    });
    const importToken = await createAuthToken(importUser.id);

    const importRes = await api("/import/properties", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + importToken,
        "Content-Type": "text/csv",
      },
      body: buildCsv([propertyRow("Terceira Casa")]),
    });
    expect(importRes.status).toBe(403);
    const importBody = (await importRes.json()) as { message: string };

    expect(importBody.message).toBe(unitPathBody.message);
  });

  it("rejects a batch with an invalid row and persists nothing", async () => {
    const { user } = await createUserFixture({
      name: "Dono de Imóvel",
      email: "import.invalid-row@sogio.dev",
      password: "password123",
    });
    await upgradeToPro(user.id);
    const token = await createAuthToken(user.id);

    const csv = buildCsv([
      propertyRow("Casa Válida"),
      propertyRow("Casa Inválida", -1),
    ]);

    const res = await api("/import/properties", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "text/csv",
      },
      body: csv,
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      message: string;
      failures: Array<{ row: number; field: string | null; message: string }>;
      truncated: boolean;
    };
    expect(body.truncated).toBe(false);
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]?.row).toBe(3);
    expect(body.failures[0]?.field).toBe("capacity");
    expect(await countPropertiesOfUser(user.id)).toBe(0);
  });

  it("keeps the keep-alive connection usable after a CSV rejected for a missing required column, so the next request on it is served quickly", async () => {
    const { user } = await createUserFixture({
      name: "Dono de Imóvel",
      email: "import.connection-survives@sogio.dev",
      password: "password123",
    });
    await upgradeToPro(user.id);
    const token = await createAuthToken(user.id);

    const rejected = await api("/import/properties", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "text/csv",
      },
      body: makePacedRejectedCsvStream(3 * 1024 * 1024, 64 * 1024, 5),
      duplex: "half",
    } as RequestInit);
    const rejectedBody = (await rejected.json()) as {
      failures: Array<{ row: number; field: string | null; message: string }>;
    };

    expect(rejected.status).toBe(422);
    expect(rejectedBody.failures.some(f => f.field === "country")).toBe(true);

    const CONNECTION_SURVIVAL_TIMEOUT_MS = 3_000;
    const start = performance.now();
    const followUp = await api("/property/user/all", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(CONNECTION_SURVIVAL_TIMEOUT_MS),
    });
    const elapsedMs = performance.now() - start;
    await followUp.json();

    expect(followUp.status).toBe(200);
    expect(elapsedMs).toBeLessThan(CONNECTION_SURVIVAL_TIMEOUT_MS);
  });
});
