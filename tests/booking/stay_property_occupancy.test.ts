import { describe, expect, it } from "bun:test";
import { Stay } from "../../src/booking/domain/entity/stay";
import { Tenant } from "../../src/booking/domain/entity/tenant";
import { StayPropertyOccupancy } from "../../src/booking/application/service/stay_property_occupancy";
import type {
  StayRepository,
  StayWithTenant,
} from "../../src/booking/domain/repository/stay_repository";
import type { CancelStayService } from "../../src/booking/application/service/cancel_stay_service";
import { ConflictError } from "../../src/core/application/error/conflict_error";

function makeStayWithTenant(checkIn: Date, checkOut: Date): StayWithTenant {
  const tenant = Tenant.create({
    owner_id: crypto.randomUUID(),
    name: "Ana Souza",
    phone: "5511999990001",
    sex: "FEMALE",
  });
  const stay = Stay.create({
    check_in: checkIn,
    check_out: checkOut,
    tenant_id: tenant.id,
    property_id: crypto.randomUUID(),
    guests: 2,
    entrance_code: "1234",
    price: 10000,
    source: "DIRECT",
  });
  return { stay, tenant };
}

function ensureNoStayInProgress(inProgressCount: number): void {
  if (inProgressCount > 0) {
    throw new ConflictError(
      "This property has a guest checked in right now. You can delete it once the current stay ends."
    );
  }
}

/**
 * Unit-level coverage of the check_in race described in §8.2/DA-3-R:
 * `allFutureFromProperty` classifies a stay as future, but by the time the
 * per-stay recheck runs its check_in has passed. Uses fakes instead of a
 * real clock so the timing is controlled rather than raced against a real
 * database — the "racing" stay's check_in sits inside a window a slow fake
 * cancellation of the first stay is guaranteed to cross.
 */
describe("StayPropertyOccupancy.releaseFutureOccupancy — the check_in race (§8.2)", () => {
  it("aborts the whole operation with the same ConflictError instead of skipping the stay that started mid-cascade, and never cancels it", async () => {
    const now = Date.now();
    // Comfortably future for both its own partition and its own recheck.
    const safelyFutureStay = makeStayWithTenant(
      new Date(now + 10_000),
      new Date(now + 20_000)
    );
    // Still future at partition time (evaluated almost immediately), but
    // will have started by the time the loop reaches its recheck, because
    // the fake cancellation of `safelyFutureStay` below is deliberately slow.
    const racingStay = makeStayWithTenant(
      new Date(now + 40),
      new Date(now + 20_000)
    );

    const stayRepository = {
      allFutureFromProperty: async () => [safelyFutureStay, racingStay],
    } as unknown as StayRepository;

    const canceledStayIds: string[] = [];
    const cancelStayService = {
      cancel: async (stay: Stay) => {
        canceledStayIds.push(stay.id);
        if (stay.id === safelyFutureStay.stay.id) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      },
    } as unknown as CancelStayService;

    const occupancy = new StayPropertyOccupancy(
      stayRepository,
      cancelStayService
    );

    await expect(
      occupancy.releaseFutureOccupancy(
        crypto.randomUUID(),
        ensureNoStayInProgress
      )
    ).rejects.toBeInstanceOf(ConflictError);

    expect(canceledStayIds).toEqual([safelyFutureStay.stay.id]);
  });
});
