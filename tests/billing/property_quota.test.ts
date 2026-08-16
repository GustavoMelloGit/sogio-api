import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";

const TABLES = ["properties", "addresses", "users"];

function validBody(name: string) {
  return {
    name,
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
    images: ["https://example.com/1.jpg"],
    capacity: 2,
  };
}

describe("max_properties quota on property creation (DA-10)", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("blocks creation once the Free plan's limit (1) is reached", async () => {
    const { user } = await createUserFixture({
      name: "Dono de Imóvel",
      email: "quota.free@sogio.dev",
      password: "password123",
    });
    await createPropertyFixture({ userId: user.id, name: "Primeira Casa" });
    const token = await createAuthToken(user.id);

    const res = await api("/property", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify(validBody("Segunda Casa")),
    });

    expect(res.status).toBe(403);
  });

  it("allows creation while under the plan's limit", async () => {
    const { user } = await createUserFixture({
      name: "Dono de Imóvel",
      email: "quota.under-limit@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);

    const res = await api("/property", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify(validBody("Primeira Casa")),
    });

    expect(res.status).toBe(200);
  });

  it("does not count a soft-deleted property against the quota", async () => {
    const { user } = await createUserFixture({
      name: "Dono de Imóvel",
      email: "quota.soft-deleted@sogio.dev",
      password: "password123",
    });
    const deletedProperty = await createPropertyFixture({
      userId: user.id,
      name: "Casa Removida",
    });

    const { db } = await import(
      "../../src/core/infra/database/drizzle/database"
    );
    const { propertiesTable } = await import(
      "../../src/core/infra/database/drizzle/schema"
    );
    const { eq } = await import("drizzle-orm");
    await db
      .update(propertiesTable)
      .set({ deleted_at: new Date() })
      .where(eq(propertiesTable.id, deletedProperty.id));

    const token = await createAuthToken(user.id);

    const res = await api("/property", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify(validBody("Casa Nova")),
    });

    expect(res.status).toBe(200);
  });
});
