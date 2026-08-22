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
  staysTable,
} from "../../src/core/infra/database/drizzle/schema";
import { PropertyManagementDi } from "../../src/property_management/infra/di/property_management_di";
import { PropertyPostgresRepository } from "../../src/property_management/infra/database/postgres_repository/property_postgres_repository";
import { DeletePropertyUseCase } from "../../src/property_management/application/use_case/delete_property";
import { StayPropertyOccupancy } from "../../src/booking/application/service/stay_property_occupancy";
import { CancelStayService } from "../../src/booking/application/service/cancel_stay_service";
import { StayPostgresRepository } from "../../src/booking/infra/database/postgres_repository/stay_postgres_repository";
import { StayCanceledEvent } from "../../src/booking/domain/event/stay_canceled_event";
import { DrizzleTransactionRunner } from "../../src/core/infra/database/drizzle/drizzle_transaction_runner";
import { LedgerEntryPostgresRepository } from "../../src/finance/infra/database/postgres_repository/ledger_entry_postgres_repository";
import { UserDisplayPreferencesService } from "../../src/auth/application/service/user_display_preferences_service";
import { AuthPostgresRepository } from "../../src/auth/infra/database/postgres_repository/auth_postgres_repository";
import { RevertRevenueOnStayCancel } from "../../src/finance/application/handler/revert_revenue_on_stay_cancel";
import { ConflictError } from "../../src/core/application/error/conflict_error";
import { ConsoleLogger } from "../../src/core/infra/logger/console_logger";
import { inMemoryEventDispatcher } from "../../src/core/infra/event/in_memory_event_dispatcher";
import type { EventDispatcher } from "../../src/core/application/event/event_dispatcher";
import type { EventHandler } from "../../src/core/application/event/event_handler";
import type { DomainEvent } from "../../src/core/domain/event/domain_event";
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

/**
 * Minimal `EventDispatcher` local to a single test, so
 * `RevertRevenueOnStayCancel` can be registered with a repository that
 * fails on purpose without touching the shared `inMemoryEventDispatcher`
 * singleton every other test relies on.
 */
class TestEventDispatcher implements EventDispatcher {
  #handlers = new Map<string, EventHandler<DomainEvent>[]>();

  register(eventName: string, handler: EventHandler<DomainEvent>): void {
    const list = this.#handlers.get(eventName) ?? [];
    list.push(handler);
    this.#handlers.set(eventName, list);
  }

  async dispatch(event: DomainEvent): Promise<void> {
    const handlers = this.#handlers.get(event.name) ?? [];
    await Promise.all(handlers.map(handler => handler.handle(event)));
  }
}

/** Simulates a failure mid-cascade (task 17) without touching real ledger rows. */
class FailingLedgerEntryRepository extends LedgerEntryPostgresRepository {
  override async save(): Promise<void> {
    throw new Error("simulated failure mid-cascade");
  }
}

/**
 * Same wiring `PropertyManagementDi`/`StayDi.makeStayPropertyOccupancy` use
 * in production, built directly so these tests can assert on
 * `DeletePropertyUseCase`'s return value and thrown errors without going
 * through `DELETE /property/:property_id`'s rate limit (30/60s, shared
 * process-wide across every test file that hits that route — see
 * `RATE_LIMIT_POLICY` on the controller). Behavior is identical either way;
 * this only skips the HTTP layer for tests that don't need to assert on it.
 */
function makeRealDeletePropertyUseCase(): DeletePropertyUseCase {
  return new DeletePropertyUseCase(
    new PropertyPostgresRepository(),
    makeTestPropertyOccupancy(),
    new DrizzleTransactionRunner()
  );
}

function makeDeletePropertyUseCaseWithFailingLedger(): DeletePropertyUseCase {
  const stayRepository = new StayPostgresRepository();
  const failingEventDispatcher = new TestEventDispatcher();
  failingEventDispatcher.register(
    StayCanceledEvent.NAME,
    new RevertRevenueOnStayCancel(
      new ConsoleLogger(),
      new FailingLedgerEntryRepository(),
      new PropertyPostgresRepository(),
      new UserDisplayPreferencesService(new AuthPostgresRepository())
    )
  );
  const cancelStayService = new CancelStayService(
    stayRepository,
    failingEventDispatcher
  );
  const propertyOccupancy = new StayPropertyOccupancy(
    stayRepository,
    cancelStayService
  );

  return new DeletePropertyUseCase(
    new PropertyPostgresRepository(),
    propertyOccupancy,
    new DrizzleTransactionRunner()
  );
}

describe("DELETE /property/:property_id", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("200 — soft-deletes a property with no pending stays", async () => {
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

    expect(res.status).toBe(200);
    const body = (await res.json()) as { canceled_stays: number };
    expect(body.canceled_stays).toBe(0);

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
    expect(firstDelete.status).toBe(200);

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

  it("200 — cancels a future stay in cascade instead of blocking the deletion (DA-4-R)", async () => {
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

    const res = await api(`/property/${property.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { canceled_stays: number };
    expect(body.canceled_stays).toBe(1);

    const propertyRows = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, property.id));
    expect(propertyRows[0]?.deleted_at).not.toBeNull();

    const stayRows = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.id, bookBody.data.id));
    expect(stayRows[0]?.deleted_at).not.toBeNull();
  });

  it("409 — rejects deleting a property with a stay in progress right now, and the message names the guest, not the future stay (DA-4-R)", async () => {
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
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe(
      "This property has a guest checked in right now. You can delete it once the current stay ends."
    );

    const rows = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, property.id));
    expect(rows[0]?.deleted_at).toBeNull();
  });

  it("409 is total — an in-progress stay blocks the whole operation, leaving every future stay untouched", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const now = new Date();
    const inProgressRes = await bookStay(
      token,
      property.id,
      {
        check_in: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        check_out: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      },
      "5511999990001"
    );
    expect(inProgressRes.status).toBe(200);
    const inProgressBody = (await inProgressRes.json()) as {
      data: { id: string };
    };

    const futureRes1 = await bookStay(
      token,
      property.id,
      {
        check_in: "2040-06-01T12:00:00.000Z",
        check_out: "2040-06-03T12:00:00.000Z",
      },
      "5511999990002"
    );
    expect(futureRes1.status).toBe(200);
    const futureBody1 = (await futureRes1.json()) as { data: { id: string } };

    const futureRes2 = await bookStay(
      token,
      property.id,
      {
        check_in: "2041-06-01T12:00:00.000Z",
        check_out: "2041-06-03T12:00:00.000Z",
      },
      "5511999990003"
    );
    expect(futureRes2.status).toBe(200);
    const futureBody2 = (await futureRes2.json()) as { data: { id: string } };

    // Exercised at the use-case level (see makeRealDeletePropertyUseCase's
    // docblock) rather than through HTTP, so this test doesn't compete for
    // DeletePropertyController's process-wide, per-IP rate limit budget
    // with every other test file hitting the same route.
    const useCase = makeRealDeletePropertyUseCase();
    await expect(
      useCase.execute({ property_id: property.id }, user)
    ).rejects.toBeInstanceOf(ConflictError);

    const propertyRows = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, property.id));
    expect(propertyRows[0]?.deleted_at).toBeNull();

    const stayRows = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.property_id, property.id));
    const staysById = new Map(stayRows.map(row => [row.id, row]));

    expect(staysById.get(inProgressBody.data.id)?.deleted_at).toBeNull();
    expect(staysById.get(futureBody1.data.id)?.deleted_at).toBeNull();
    expect(staysById.get(futureBody2.data.id)?.deleted_at).toBeNull();
  });

  it("tudo ou nada — a failure mid-cascade leaves the property active and every stay and ledger row untouched (DA-13)", async () => {
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

    const ledgerRowsBefore = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));

    const useCase = makeDeletePropertyUseCaseWithFailingLedger();

    // Asserts the exact simulated error escapes untouched, proving the
    // rollback below happened because of this failure — not because it got
    // swallowed and replaced by something else (e.g. IllegalStateError).
    await expect(
      useCase.execute({ property_id: property.id }, user)
    ).rejects.toThrow("simulated failure mid-cascade");

    const propertyRows = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, property.id));
    expect(propertyRows[0]?.deleted_at).toBeNull();

    const stayRows = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.id, bookBody.data.id));
    expect(stayRows[0]?.deleted_at).toBeNull();

    const ledgerRowsAfter = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));
    expect(ledgerRowsAfter).toHaveLength(ledgerRowsBefore.length);
  });

  it("R-15 — exactly one handler is registered for StayCanceledEvent", () => {
    // Guards DA-13; doesn't catch an external effect added to the existing handler.
    expect(
      inMemoryEventDispatcher.handlerCountFor(StayCanceledEvent.NAME)
    ).toBe(1);
  });

  it("estorno (R-14) and não sobra estadia viva (R-10) — cancelling N stays in cascade records N negative ledger entries and leaves none of them live", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const token = await createAuthToken(user.id);

    const futureRes1 = await bookStay(
      token,
      property.id,
      {
        check_in: "2040-06-01T12:00:00.000Z",
        check_out: "2040-06-03T12:00:00.000Z",
      },
      "5511999990001"
    );
    expect(futureRes1.status).toBe(200);
    const futureRes2 = await bookStay(
      token,
      property.id,
      {
        check_in: "2041-06-01T12:00:00.000Z",
        check_out: "2041-06-03T12:00:00.000Z",
      },
      "5511999990002"
    );
    expect(futureRes2.status).toBe(200);

    // See makeRealDeletePropertyUseCase's docblock for why this bypasses
    // HTTP: the assertions below don't depend on the controller/adapter at
    // all, and every DELETE /property/:property_id call — regardless of
    // which test file makes it — shares one process-wide rate limit budget.
    const useCase = makeRealDeletePropertyUseCase();
    const output = await useCase.execute({ property_id: property.id }, user);
    expect(output.canceled_stays).toBe(2);

    const ledgerRows = await db
      .select()
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.property_id, property.id));
    const reversals = ledgerRows.filter(row => Number(row.amount) < 0);
    expect(reversals).toHaveLength(2);

    const stayRows = await db
      .select()
      .from(staysTable)
      .where(eq(staysTable.property_id, property.id));
    const now = new Date();
    const stillLive = stayRows.filter(
      row => row.deleted_at === null && row.check_out >= now
    );
    expect(stillLive).toHaveLength(0);
  });

  it("200 — a property with only a past stay can be deleted", async () => {
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

    expect(res.status).toBe(200);
  });

  it("200 — a property whose only future stay was cancelled can be deleted", async () => {
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

    expect(res.status).toBe(200);
    const body = (await res.json()) as { canceled_stays: number };
    expect(body.canceled_stays).toBe(0);
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
    expect(deleteRes.status).toBe(200);

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
    expect(deleteRes.status).toBe(200);

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

    it("GET /tenants still lists a guest staying at an active property after another property from the same owner is deleted", async () => {
      const { user } = await createUserFixture({
        name: "João Silva",
        email: "joao@sogio.dev",
        password: "password123",
      });
      const deletedProperty = await createPropertyFixture({
        userId: user.id,
      });
      const activeProperty = await createPropertyFixture({
        userId: user.id,
      });
      const token = await createAuthToken(user.id);

      const deletedPropertyBookRes = await bookStay(
        token,
        deletedProperty.id,
        {
          check_in: "2020-06-01T12:00:00.000Z",
          check_out: "2020-06-03T12:00:00.000Z",
        },
        "5511999990001"
      );
      expect(deletedPropertyBookRes.status).toBe(200);

      const activePropertyBookRes = await bookStay(
        token,
        activeProperty.id,
        {
          check_in: "2020-07-01T12:00:00.000Z",
          check_out: "2020-07-03T12:00:00.000Z",
        },
        "5511999990002"
      );
      expect(activePropertyBookRes.status).toBe(200);

      await api(`/property/${deletedProperty.id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });

      const afterRes = await api("/tenants", {
        headers: { Authorization: "Bearer " + token },
      });
      const afterBody = (await afterRes.json()) as Array<{ id: string }>;
      expect(afterBody).toHaveLength(1);
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
