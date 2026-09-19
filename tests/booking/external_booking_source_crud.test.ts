import { describe, it, expect, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { createAuthToken } from "../helpers/fixtures/auth_token";
import { db } from "../../src/core/infra/database/drizzle/database";
import { externalBookingSources } from "../../src/core/infra/database/drizzle/schema";
import { ExternalBookingSourcePostgresRepository } from "../../src/booking/infra/database/postgres_repository/external_booking_source_postgres_repository";

const TABLES = ["external_booking_sources", "properties", "addresses", "users"];

const SYNC_URL = "https://www.airbnb.com/calendar/ical/12345.ics";
const OTHER_SYNC_URL = "https://ical.booking.com/v1/export?t=67890";

type SourceDto = {
  id: string;
  property_id: string;
  platform_name: string;
  sync_url: string;
  created_at: string;
  updated_at: string;
};

type ListBody = { external_booking_sources: SourceDto[] };

async function createOwner(email: string): Promise<{
  token: string;
  propertyId: string;
}> {
  const { user } = await createUserFixture({
    name: "João Silva",
    email,
    password: "password123",
  });
  const property = await createPropertyFixture({ userId: user.id });

  return { token: await createAuthToken(user.id), propertyId: property.id };
}

async function connectCalendar(
  token: string,
  propertyId: string,
  platformName = "AIRBNB",
  syncUrl = SYNC_URL
): Promise<SourceDto> {
  const response = await api(
    `/booking/property/${propertyId}/external-booking`,
    {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify({ platform_name: platformName, sync_url: syncUrl }),
    }
  );
  expect(response.status).toBe(200);

  return (await response.json()) as SourceDto;
}

describe("External booking source CRUD", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("lists every calendar connected to the property, unpaginated", async () => {
    const { token, propertyId } = await createOwner("list@sogio.dev");
    await connectCalendar(token, propertyId, "AIRBNB", SYNC_URL);
    await connectCalendar(token, propertyId, "BOOKING", OTHER_SYNC_URL);

    const response = await api(
      `/booking/property/${propertyId}/external-booking`,
      { headers: { Authorization: "Bearer " + token } }
    );
    const body = (await response.json()) as ListBody;

    expect(response.status).toBe(200);
    expect(body.external_booking_sources).toHaveLength(2);
    expect(
      body.external_booking_sources.map(source => source.platform_name).sort()
    ).toEqual(["AIRBNB", "BOOKING"]);
    expect(body.external_booking_sources[0]?.sync_url).toBeDefined();
  });

  it("returns an empty list — not an error — for a property with no calendar", async () => {
    const { token, propertyId } = await createOwner("empty@sogio.dev");

    const response = await api(
      `/booking/property/${propertyId}/external-booking`,
      { headers: { Authorization: "Bearer " + token } }
    );
    const body = (await response.json()) as ListBody;

    expect(response.status).toBe(200);
    expect(body.external_booking_sources).toEqual([]);
  });

  it("fetches a single calendar by id", async () => {
    const { token, propertyId } = await createOwner("get@sogio.dev");
    const created = await connectCalendar(token, propertyId);

    const response = await api(
      `/booking/property/${propertyId}/external-booking/${created.id}`,
      { headers: { Authorization: "Bearer " + token } }
    );
    const body = (await response.json()) as SourceDto;

    expect(response.status).toBe(200);
    expect(body.id).toBe(created.id);
    expect(body.platform_name).toBe("AIRBNB");
    expect(body.sync_url).toBe(SYNC_URL);
  });

  it("updates the sync url, normalizing a patched platform name", async () => {
    const { token, propertyId } = await createOwner("update@sogio.dev");
    const created = await connectCalendar(token, propertyId);

    const response = await api(
      `/booking/property/${propertyId}/external-booking/${created.id}`,
      {
        method: "PUT",
        headers: { Authorization: "Bearer " + token },
        body: JSON.stringify({
          platform_name: "booking com",
          sync_url: OTHER_SYNC_URL,
        }),
      }
    );
    const body = (await response.json()) as SourceDto;

    expect(response.status).toBe(200);
    expect(body.platform_name).toBe("BOOKING_COM");
    expect(body.sync_url).toBe(OTHER_SYNC_URL);
    expect(body.id).toBe(created.id);
  });

  it("leaves untouched fields alone on a partial update", async () => {
    const { token, propertyId } = await createOwner("partial@sogio.dev");
    const created = await connectCalendar(token, propertyId);

    const response = await api(
      `/booking/property/${propertyId}/external-booking/${created.id}`,
      {
        method: "PUT",
        headers: { Authorization: "Bearer " + token },
        body: JSON.stringify({ sync_url: OTHER_SYNC_URL }),
      }
    );
    const body = (await response.json()) as SourceDto;

    expect(response.status).toBe(200);
    expect(body.platform_name).toBe("AIRBNB");
    expect(body.sync_url).toBe(OTHER_SYNC_URL);
  });

  /**
   * The adapter resolves input as `{ ...query, ...body, ...params }`, so the
   * path parameter wins. A `property_id` smuggled in the body must therefore
   * never move the calendar, nor steer the ownership check at a property the
   * body picked — the path is what the caller was authorized against.
   */
  it("ignores a property_id smuggled in the update body", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "immutable@sogio.dev",
      password: "password123",
    });
    const first = await createPropertyFixture({ userId: user.id });
    const second = await createPropertyFixture({
      userId: user.id,
      name: "Second Property",
    });
    const token = await createAuthToken(user.id);
    const created = await connectCalendar(token, first.id);

    const response = await api(
      `/booking/property/${first.id}/external-booking/${created.id}`,
      {
        method: "PUT",
        headers: { Authorization: "Bearer " + token },
        body: JSON.stringify({
          property_id: second.id,
          sync_url: OTHER_SYNC_URL,
        }),
      }
    );
    const body = (await response.json()) as SourceDto;

    expect(response.status).toBe(200);
    expect(body.property_id).toBe(first.id);
    expect(body.sync_url).toBe(OTHER_SYNC_URL);
  });

  it("204 — soft-deletes the calendar, keeping the row in the database", async () => {
    const { token, propertyId } = await createOwner("delete@sogio.dev");
    const created = await connectCalendar(token, propertyId);

    const response = await api(
      `/booking/property/${propertyId}/external-booking/${created.id}`,
      { method: "DELETE", headers: { Authorization: "Bearer " + token } }
    );

    expect(response.status).toBe(204);

    const rows = await db
      .select()
      .from(externalBookingSources)
      .where(eq(externalBookingSources.id, created.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.deleted_at).not.toBeNull();
  });

  it("hides a deleted calendar from both the listing and the fetch", async () => {
    const { token, propertyId } = await createOwner("hidden@sogio.dev");
    const created = await connectCalendar(token, propertyId);

    await api(
      `/booking/property/${propertyId}/external-booking/${created.id}`,
      { method: "DELETE", headers: { Authorization: "Bearer " + token } }
    );

    const listResponse = await api(
      `/booking/property/${propertyId}/external-booking`,
      { headers: { Authorization: "Bearer " + token } }
    );
    const listBody = (await listResponse.json()) as ListBody;
    const getResponse = await api(
      `/booking/property/${propertyId}/external-booking/${created.id}`,
      { headers: { Authorization: "Bearer " + token } }
    );

    expect(listBody.external_booking_sources).toEqual([]);
    expect(getResponse.status).toBe(404);
  });

  /**
   * The point of the soft delete: `ReconcileExternalBookingsUseCase` reads
   * calendars through `allFromProperty`, so a deleted feed must disappear
   * from it too — otherwise "disconnect" would leave the sync running.
   */
  it("stops a deleted calendar from being read by reconciliation", async () => {
    const { token, propertyId } = await createOwner("reconcile@sogio.dev");
    const created = await connectCalendar(token, propertyId);
    const repository = new ExternalBookingSourcePostgresRepository();

    expect(await repository.allFromProperty(propertyId)).toHaveLength(1);

    await api(
      `/booking/property/${propertyId}/external-booking/${created.id}`,
      { method: "DELETE", headers: { Authorization: "Bearer " + token } }
    );

    expect(await repository.allFromProperty(propertyId)).toHaveLength(0);
  });

  it("404 — a second deletion of the same calendar is not found", async () => {
    const { token, propertyId } = await createOwner("twice@sogio.dev");
    const created = await connectCalendar(token, propertyId);
    const path = `/booking/property/${propertyId}/external-booking/${created.id}`;

    const first = await api(path, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    const second = await api(path, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });

    expect(first.status).toBe(204);
    expect(second.status).toBe(404);
  });

  it("404 — every read and write rejects another user's property", async () => {
    const owner = await createOwner("owner@sogio.dev");
    const intruder = await createOwner("intruder@sogio.dev");
    const created = await connectCalendar(owner.token, owner.propertyId);
    const headers = { Authorization: "Bearer " + intruder.token };
    const itemPath = `/booking/property/${owner.propertyId}/external-booking/${created.id}`;

    const list = await api(
      `/booking/property/${owner.propertyId}/external-booking`,
      { headers }
    );
    const get = await api(itemPath, { headers });
    const update = await api(itemPath, {
      method: "PUT",
      headers,
      body: JSON.stringify({ sync_url: OTHER_SYNC_URL }),
    });
    const remove = await api(itemPath, { method: "DELETE", headers });

    expect(list.status).toBe(404);
    expect(get.status).toBe(404);
    expect(update.status).toBe(404);
    expect(remove.status).toBe(404);
  });

  /**
   * A calendar id from one property must not be reachable through another
   * property the caller does own — the id alone is not authority.
   */
  it("404 — a calendar id cannot be read through a different owned property", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "crossed@sogio.dev",
      password: "password123",
    });
    const first = await createPropertyFixture({ userId: user.id });
    const second = await createPropertyFixture({
      userId: user.id,
      name: "Second Property",
    });
    const token = await createAuthToken(user.id);
    const created = await connectCalendar(token, first.id);

    const response = await api(
      `/booking/property/${second.id}/external-booking/${created.id}`,
      { headers: { Authorization: "Bearer " + token } }
    );

    expect(response.status).toBe(404);
  });

  it("401 — every route requires authentication", async () => {
    const { token, propertyId } = await createOwner("anon@sogio.dev");
    const created = await connectCalendar(token, propertyId);

    const list = await api(`/booking/property/${propertyId}/external-booking`);
    const get = await api(
      `/booking/property/${propertyId}/external-booking/${created.id}`
    );

    expect(list.status).toBe(401);
    expect(get.status).toBe(401);
  });
});
