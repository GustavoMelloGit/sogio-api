import { describe, it, expect } from "bun:test";
import { ExternalCalendarEventPolicy } from "../../src/booking/domain/policy/external_calendar_event_policy";

describe("ExternalCalendarEventPolicy.isBooking", () => {
  it("accepts an Airbnb event with summary Reserved", () => {
    expect(
      ExternalCalendarEventPolicy.isBooking({
        uid: "abc123@airbnb.com",
        summary: "Reserved",
      })
    ).toBe(true);
  });

  it("rejects an Airbnb event whose summary is not exactly Reserved", () => {
    expect(
      ExternalCalendarEventPolicy.isBooking({
        uid: "abc123@airbnb.com",
        summary: "Airbnb (Not available)",
      })
    ).toBe(false);
  });

  it("rejects an Airbnb event with a missing summary", () => {
    expect(
      ExternalCalendarEventPolicy.isBooking({
        uid: "abc123@airbnb.com",
      })
    ).toBe(false);
  });

  it("rejects a Booking.com blocked period", () => {
    expect(
      ExternalCalendarEventPolicy.isBooking({
        uid: "abc123@booking.com",
        summary: "CLOSED - Not available",
      })
    ).toBe(false);
  });

  it("accepts a Booking.com reservation", () => {
    expect(
      ExternalCalendarEventPolicy.isBooking({
        uid: "abc123@booking.com",
        summary: "Guest name",
      })
    ).toBe(true);
  });

  it("rejects a Vrbo blocked period via homeaway.com uid", () => {
    expect(
      ExternalCalendarEventPolicy.isBooking({
        uid: "abc123@homeaway.com",
        summary: "Blocked",
      })
    ).toBe(false);
  });

  it("rejects a Vrbo unavailable period via vrbo.com uid", () => {
    expect(
      ExternalCalendarEventPolicy.isBooking({
        uid: "abc123@vrbo.com",
        summary: "Unavailable",
      })
    ).toBe(false);
  });

  it("accepts a Vrbo reservation", () => {
    expect(
      ExternalCalendarEventPolicy.isBooking({
        uid: "abc123@vrbo.com",
        summary: "Reservation",
      })
    ).toBe(true);
  });

  it("rejects an unknown provider's event with a generic unavailable phrase", () => {
    expect(
      ExternalCalendarEventPolicy.isBooking({
        uid: "abc123@some-other-provider.com",
        summary: "Not Available",
      })
    ).toBe(false);
  });

  it("rejects a no-uid event whose summary matches busy, case-insensitively", () => {
    expect(
      ExternalCalendarEventPolicy.isBooking({
        summary: "BUSY",
      })
    ).toBe(false);
  });

  it("accepts an unknown provider's event by default (fail-open)", () => {
    expect(
      ExternalCalendarEventPolicy.isBooking({
        uid: "abc123@some-other-provider.com",
        summary: "Jane Doe - 3 nights",
      })
    ).toBe(true);
  });

  it("accepts a no-uid event with a missing summary", () => {
    expect(ExternalCalendarEventPolicy.isBooking({})).toBe(true);
  });
});
