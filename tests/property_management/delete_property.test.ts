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
  propertiesTable,
  propertySettingsTable,
} from "../../src/core/infra/database/drizzle/schema";
import { PropertyManagementDi } from "../../src/property_management/infra/di/property_management_di";
import { makeTestEntitlementService } from "../helpers/entitlement_service";
import { makeTestPropertyOccupancy } from "../helpers/property_occupancy";

const TABLES = [
  "stays",
  "tenants",
  "ledger_entries",
  "property_settings",
  "external_booking_sources",
  "properties",
  "addresses",
  "users",
];

async function bookStay(
  token: string,
  propertyId: string,
  period: { check_in: string; check_out: string },
  phone = "5511999990001"
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
      tenant: { name: "Ana Souza", phone, sex: "FEMALE" },
    }),
  });
}

async function createSetting(
  propertyId: string,
  user: Awaited<ReturnType<typeof createUserFixture>>["user"]
) {
  const propertyManagementDi = new PropertyManagementDi(
    makeTestEntitlementService(),
    makeTestPropertyOccupancy()
  );
  return propertyManagementDi.makeCreatePropertySettingUseCase().execute(
    {
      property_id: propertyId,
      key: "checkin_time",
      value: "14:00",
      type: "string",
      description: "Check-in time",
    },
    user
  );
}

describe("DELETE /property/:property_id", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("204 — soft-deletes a property with no pending stays", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const res = await api(`/property/${property.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(204);

    const rows = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, property.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.deleted_at).not.toBeNull();
  });

  it("401 — rejects request without auth token", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const res = await api(`/property/${property.id}`, { method: "DELETE" });

    expect(res.status).toBe(401);
  });

  it("404 — rejects deleting a property belonging to another user, never 403", async () => {
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
    const token = await createAuthToken(intruder.id);

    const res = await api(`/property/${property.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(404);

    const rows = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, property.id));
    expect(rows[0]?.deleted_at).toBeNull();
  });

  it("404 — rejects deleting a nonexistent property", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);

    const res = await api(`/property/${crypto.randomUUID()}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(404);
  });

  it("404, not 500 — deleting an already-deleted property does not try to recreate it (R-2)", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const firstDelete = await api(`/property/${property.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    expect(firstDelete.status).toBe(204);

    const secondDelete = await api(`/property/${property.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    expect(secondDelete.status).toBe(404);

    const rows = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, property.id));
    expect(rows).toHaveLength(1);
  });

  it("409 — rejects deleting a property with a future stay", async () => {
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

    const res = await api(`/property/${property.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(409);

    const rows = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, property.id));
    expect(rows[0]?.deleted_at).toBeNull();
  });

  it("409 — rejects deleting a property with a stay in progress", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const now = new Date();
    const checkIn = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const checkOut = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const bookRes = await bookStay(token, property.id, {
      check_in: checkIn.toISOString(),
      check_out: checkOut.toISOString(),
    });
    expect(bookRes.status).toBe(200);

    const res = await api(`/property/${property.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(409);
  });

  it("204 — a property with only a past stay can be deleted", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const bookRes = await bookStay(token, property.id, {
      check_in: "2020-06-01T12:00:00.000Z",
      check_out: "2020-06-03T12:00:00.000Z",
    });
    expect(bookRes.status).toBe(200);

    const res = await api(`/property/${property.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(204);
  });

  it("204 — a property whose only future stay was cancelled can be deleted", async () => {
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

    const cancelRes = await api(`/booking/stay/${bookBody.data.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    expect(cancelRes.status).toBe(200);

    const res = await api(`/property/${property.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(204);
  });

  it("preserves LedgerEntry and PropertySetting rows in the database after deletion (DA-5, DA-6)", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const setting = await createSetting(property.id, user);

    const revenueRes = await api(`/finance/${property.id}/revenue`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({
        amount: 100000,
        description: "Pagamento",
        category: "ESTADIA",
      }),
    });
    expect(revenueRes.status).toBe(204);

    const deleteRes = await api(`/property/${property.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    expect(deleteRes.status).toBe(204);

    const ledgerRows = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));
    expect(ledgerRows).toHaveLength(1);

    const settingRows = await db
      .select()
      .from(propertySettingsTable)
      .where(eq(propertySettingsTable.id, setting.id));
    expect(settingRows).toHaveLength(1);
    expect(settingRows[0]?.deleted_at).toBeNull();
  });

  it("quota: deleting a property frees a slot for a new one on the Free plan (max_properties: 1)", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const validBody = {
      name: "Nova Propriedade",
      address: {
        street: "Rua Nova",
        number: "10",
        neighborhood: "Centro",
        city: "São Paulo",
        state: "SP",
        zip_code: "01310-100",
        country: "Brasil",
        complement: "",
      },
      images: ["https://example.com/image.jpg"],
      capacity: 2,
    };

    const overQuotaRes = await api("/property", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify(validBody),
    });
    expect(overQuotaRes.status).toBe(403);

    const deleteRes = await api(`/property/${property.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    expect(deleteRes.status).toBe(204);

    const afterDeleteRes = await api("/property", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify(validBody),
    });
    expect(afterDeleteRes.status).toBe(200);
  });

  describe("invisibility sweep (R-7) — a deleted property disappears from every read/write surface", () => {
    it("GET /property/user/all no longer lists the deleted property", async () => {
      const { user } = await createUserFixture({
        name: "João Silva",
        email: "joao@sogio.dev",
        password: "password123",
      });
      const property = await createPropertyFixture({ userId: user.id });
      const token = await createAuthToken(user.id);

      await api(`/property/${property.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });

      const res = await api("/property/user/all", {
        headers: { Authorization: "Bearer " + token },
      });
      const body = (await res.json()) as {
        properties: Array<{ id: string }>;
      };

      expect(res.status).toBe(200);
      expect(body.properties.map(p => p.id)).not.toContain(property.id);
    });

    it("GET /property/:id 404s for the deleted property", async () => {
      const { user } = await createUserFixture({
        name: "João Silva",
        email: "joao@sogio.dev",
        password: "password123",
      });
      const property = await createPropertyFixture({ userId: user.id });
      const token = await createAuthToken(user.id);

      await api(`/property/${property.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });

      const res = await api(`/property/${property.id}`, {
        headers: { Authorization: "Bearer " + token },
      });
      expect(res.status).toBe(404);
    });

    it("PATCH /property/:id 404s for the deleted property", async () => {
      const { user } = await createUserFixture({
        name: "João Silva",
        email: "joao@sogio.dev",
        password: "password123",
      });
      const property = await createPropertyFixture({ userId: user.id });
      const token = await createAuthToken(user.id);

      await api(`/property/${property.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });

      const res = await api(`/property/${property.id}`, {
        method: "PATCH",
        headers: { Authorization: "Bearer " + token },
        body: JSON.stringify({ name: "Novo nome" }),
      });
      expect(res.status).toBe(404);
    });

    it("GET /dashboard/overview no longer counts the deleted property's KPIs or revenue", async () => {
      const { user } = await createUserFixture({
        name: "João Silva",
        email: "joao@sogio.dev",
        password: "password123",
      });
      const property = await createPropertyFixture({ userId: user.id });
      const token = await createAuthToken(user.id);

      await api(`/finance/${property.id}/revenue`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: JSON.stringify({
          amount: 100000,
          description: "Pagamento",
          category: "ESTADIA",
        }),
      });

      await api(`/property/${property.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });

      const res = await api("/dashboard/overview", {
        headers: { Authorization: "Bearer " + token },
      });
      const body = (await res.json()) as {
        kpis: { active_stays: number; monthly_revenue: number };
      };

      expect(res.status).toBe(200);
      expect(body.kpis.active_stays).toBe(0);
      expect(body.kpis.monthly_revenue).toBe(0);
    });

    it("GET /booking/property/:id/stays 404s for the deleted property", async () => {
      const { user } = await createUserFixture({
        name: "João Silva",
        email: "joao@sogio.dev",
        password: "password123",
      });
      const property = await createPropertyFixture({ userId: user.id });
      const token = await createAuthToken(user.id);

      await api(`/property/${property.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });

      const res = await api(`/booking/property/${property.id}/stays`, {
        headers: { Authorization: "Bearer " + token },
      });
      expect(res.status).toBe(404);
    });

    it("POST /booking/property/:id/book 404s for the deleted property", async () => {
      const { user } = await createUserFixture({
        name: "João Silva",
        email: "joao@sogio.dev",
        password: "password123",
      });
      const property = await createPropertyFixture({ userId: user.id });
      const token = await createAuthToken(user.id);

      await api(`/property/${property.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });

      const res = await bookStay(token, property.id, {
        check_in: "2040-06-01T12:00:00.000Z",
        check_out: "2040-06-03T12:00:00.000Z",
      });
      expect(res.status).toBe(404);
    });

    it("POST /booking/property/:id/external-booking 404s for the deleted property", async () => {
      const { user } = await createUserFixture({
        name: "João Silva",
        email: "joao@sogio.dev",
        password: "password123",
      });
      const property = await createPropertyFixture({ userId: user.id });
      const token = await createAuthToken(user.id);

      await api(`/property/${property.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });

      const res = await api(
        `/booking/property/${property.id}/external-booking`,
        {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
          body: JSON.stringify({
            platform_name: "AIRBNB",
            sync_url:
              "https://www.airbnb.com/calendar/ical/12345678.ics?s=abcdef",
          }),
        }
      );
      expect(res.status).toBe(404);
    });

    it("GET /finance/properties/:id/movements 404s for the deleted property", async () => {
      const { user } = await createUserFixture({
        name: "João Silva",
        email: "joao@sogio.dev",
        password: "password123",
      });
      const property = await createPropertyFixture({ userId: user.id });
      const token = await createAuthToken(user.id);

      await api(`/property/${property.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });

      const res = await api(`/finance/properties/${property.id}/movements`, {
        headers: { Authorization: "Bearer " + token },
      });
      expect(res.status).toBe(404);
    });

    it("POST /finance/:id/expense 404s for the deleted property", async () => {
      const { user } = await createUserFixture({
        name: "João Silva",
        email: "joao@sogio.dev",
        password: "password123",
      });
      const property = await createPropertyFixture({ userId: user.id });
      const token = await createAuthToken(user.id);

      await api(`/property/${property.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });

      const res = await api(`/finance/${property.id}/expense`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: JSON.stringify({
          amount: 5000,
          description: "Limpeza",
          category: "MANUTENÇÃO",
        }),
      });
      expect(res.status).toBe(404);
    });

    it("POST /finance/:id/revenue 404s for the deleted property", async () => {
      const { user } = await createUserFixture({
        name: "João Silva",
        email: "joao@sogio.dev",
        password: "password123",
      });
      const property = await createPropertyFixture({ userId: user.id });
      const token = await createAuthToken(user.id);

      await api(`/property/${property.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });

      const res = await api(`/finance/${property.id}/revenue`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: JSON.stringify({
          amount: 5000,
          description: "Pagamento",
          category: "ESTADIA",
        }),
      });
      expect(res.status).toBe(404);
    });

    it("property settings endpoints 404 for the deleted property", async () => {
      const { user } = await createUserFixture({
        name: "João Silva",
        email: "joao@sogio.dev",
        password: "password123",
      });
      const property = await createPropertyFixture({ userId: user.id });
      const token = await createAuthToken(user.id);

      const setting = await createSetting(property.id, user);

      await api(`/property/${property.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });

      const listRes = await api(`/property/${property.id}/settings`, {
        headers: { Authorization: "Bearer " + token },
      });
      expect(listRes.status).toBe(404);

      const getRes = await api(
        `/property/${property.id}/settings/${setting.id}`,
        { headers: { Authorization: "Bearer " + token } }
      );
      expect(getRes.status).toBe(404);

      const createRes = await api(`/property/${property.id}/settings`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: JSON.stringify({
          key: "another_key",
          value: "value",
          type: "string",
        }),
      });
      expect(createRes.status).toBe(404);

      const updateRes = await api(
        `/property/${property.id}/settings/${setting.id}`,
        {
          method: "PATCH",
          headers: { Authorization: "Bearer " + token },
          body: JSON.stringify({ value: "new value" }),
        }
      );
      expect(updateRes.status).toBe(404);

      const deleteSettingRes = await api(
        `/property/${property.id}/settings/${setting.id}`,
        {
          method: "DELETE",
          headers: { Authorization: "Bearer " + token },
        }
      );
      expect(deleteSettingRes.status).toBe(404);
    });

    it("GET /tenants no longer lists a guest whose only stay was on the deleted property (R-5)", async () => {
      const { user } = await createUserFixture({
        name: "João Silva",
        email: "joao@sogio.dev",
        password: "password123",
      });
      const property = await createPropertyFixture({ userId: user.id });
      const token = await createAuthToken(user.id);

      const bookRes = await bookStay(token, property.id, {
        check_in: "2020-06-01T12:00:00.000Z",
        check_out: "2020-06-03T12:00:00.000Z",
      });
      expect(bookRes.status).toBe(200);

      const beforeRes = await api("/tenants", {
        headers: { Authorization: "Bearer " + token },
      });
      const beforeBody = (await beforeRes.json()) as Array<{ id: string }>;
      expect(beforeBody).toHaveLength(1);

      await api(`/property/${property.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });

      const afterRes = await api("/tenants", {
        headers: { Authorization: "Bearer " + token },
      });
      const afterBody = (await afterRes.json()) as Array<{ id: string }>;
      expect(afterBody).toHaveLength(0);
    });

    it("GET /booking/reconcile-external-booking stops reconciling the deleted property (DA-7)", async () => {
      const { user } = await createUserFixture({
        name: "João Silva",
        email: "joao@sogio.dev",
        password: "password123",
      });
      const property = await createPropertyFixture({ userId: user.id });
      const token = await createAuthToken(user.id);

      const sourceRes = await api(
        `/booking/property/${property.id}/external-booking`,
        {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
          body: JSON.stringify({
            platform_name: "AIRBNB",
            sync_url:
              "https://www.airbnb.com/calendar/ical/12345678.ics?s=abcdef",
          }),
        }
      );
      expect(sourceRes.status).toBe(200);

      await api(`/property/${property.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });

      // With the property filtered out of allFromUser, the reconcile loop
      // never iterates it, so it never calls out to the (fake) sync_url.
      const res = await api("/booking/reconcile-external-booking", {
        headers: { Authorization: "Bearer " + token },
      });
      const body = (await res.json()) as unknown[];

      expect(res.status).toBe(200);
      expect(body).toHaveLength(0);
    });
  });
});
