import { describe, it, expect } from "bun:test";
import { ExternalBookingSource } from "../../src/booking/domain/entity/external_booking_source";

const SYNC_URL = "https://example.com/calendar.ics";

describe("ExternalBookingSource.create", () => {
  it("normalizes mixed case and collapses spaces into underscores", () => {
    const source = ExternalBookingSource.create({
      property_id: crypto.randomUUID(),
      platform_name: "Air bnb",
      sync_url: SYNC_URL,
    });

    expect(source.platform_name).toBe("AIR_BNB");
  });

  it("normalizes hyphens into underscores", () => {
    const source = ExternalBookingSource.create({
      property_id: crypto.randomUUID(),
      platform_name: "air-bnb",
      sync_url: SYNC_URL,
    });

    expect(source.platform_name).toBe("AIR_BNB");
  });

  it("normalizes a lowercase value into uppercase", () => {
    const source = ExternalBookingSource.create({
      property_id: crypto.randomUUID(),
      platform_name: "vrbo",
      sync_url: SYNC_URL,
    });

    expect(source.platform_name).toBe("VRBO");
  });

  it("trims surrounding whitespace before validating", () => {
    const source = ExternalBookingSource.create({
      property_id: crypto.randomUUID(),
      platform_name: "  vrbo  ",
      sync_url: SYNC_URL,
    });

    expect(source.platform_name).toBe("VRBO");
  });
});

describe("ExternalBookingSource.reconstitute", () => {
  it("does not normalize an already-normalized stored value", () => {
    const now = new Date();

    const source = ExternalBookingSource.reconstitute({
      id: crypto.randomUUID(),
      created_at: now,
      updated_at: now,
      property_id: crypto.randomUUID(),
      platform_name: "AIR_BNB",
      sync_url: SYNC_URL,
    });

    expect(source.platform_name).toBe("AIR_BNB");
  });

  it("throws instead of normalizing a raw lowercase value", () => {
    const now = new Date();

    expect(() =>
      ExternalBookingSource.reconstitute({
        id: crypto.randomUUID(),
        created_at: now,
        updated_at: now,
        property_id: crypto.randomUUID(),
        platform_name: "vrbo",
        sync_url: SYNC_URL,
      })
    ).toThrow();
  });
});
