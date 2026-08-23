import { describe, expect, it } from "bun:test";
import { CalendarDate } from "../../src/core/domain/calendar/calendar_date";
import { WallClockTime } from "../../src/core/domain/calendar/wall_clock_time";

describe("CalendarDate.parse", () => {
  it("parses the ISO format", () => {
    const date = CalendarDate.parse("2026-07-10");

    expect(date?.toString()).toBe("2026-07-10");
  });

  it("parses the Brazilian format", () => {
    const date = CalendarDate.parse("10/07/2026");

    expect(date?.toString()).toBe("2026-07-10");
  });

  it("rejects a calendar day that does not exist", () => {
    expect(CalendarDate.parse("2026-02-30")).toBeNull();
    expect(CalendarDate.parse("31/04/2026")).toBeNull();
  });

  it("rejects anything that is not one of the two accepted formats", () => {
    expect(CalendarDate.parse("2026-7-10")).toBeNull();
    expect(CalendarDate.parse("07/2026")).toBeNull();
    expect(CalendarDate.parse("2026-07-10T00:00:00Z")).toBeNull();
    expect(CalendarDate.parse("")).toBeNull();
  });

  it("accepts a leap day", () => {
    expect(CalendarDate.parse("2028-02-29")?.toString()).toBe("2028-02-29");
    expect(CalendarDate.parse("2026-02-29")).toBeNull();
  });
});

describe("CalendarDate.isBefore", () => {
  it("compares calendar days, not instants", () => {
    const first = CalendarDate.parse("2026-07-10")!;
    const second = CalendarDate.parse("2026-07-11")!;

    expect(first.isBefore(second)).toBe(true);
    expect(second.isBefore(first)).toBe(false);
    expect(first.isBefore(first)).toBe(false);
  });
});

describe("CalendarDate.atWallClock", () => {
  it("anchors the wall clock time in the given zone, not in UTC", () => {
    const date = CalendarDate.parse("2026-07-10")!;

    const instant = date.atWallClock(
      WallClockTime.of(14, 0),
      "America/Sao_Paulo"
    );

    expect(instant.toISOString()).toBe("2026-07-10T17:00:00.000Z");
  });

  it("keeps midnight on the same calendar day for the owner", () => {
    const date = CalendarDate.parse("2026-07-10")!;

    const instant = date.atWallClock(
      WallClockTime.MIDNIGHT,
      "America/Sao_Paulo"
    );

    expect(instant.toISOString()).toBe("2026-07-10T03:00:00.000Z");
    expect(
      new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
      }).format(instant)
    ).toBe("10/07/2026");
  });

  it("resolves UTC without any shift", () => {
    const date = CalendarDate.parse("2026-07-10")!;

    expect(date.atWallClock(WallClockTime.MIDNIGHT, "UTC").toISOString()).toBe(
      "2026-07-10T00:00:00.000Z"
    );
  });

  it("resolves a zone ahead of UTC", () => {
    const date = CalendarDate.parse("2026-07-10")!;

    expect(
      date.atWallClock(WallClockTime.of(14, 0), "Asia/Tokyo").toISOString()
    ).toBe("2026-07-10T05:00:00.000Z");
  });

  it("honours a half-hour offset", () => {
    const date = CalendarDate.parse("2026-07-10")!;

    expect(
      date.atWallClock(WallClockTime.of(14, 0), "Asia/Kolkata").toISOString()
    ).toBe("2026-07-10T08:30:00.000Z");
  });

  it("resolves both sides of a daylight saving transition", () => {
    const beforeDst = CalendarDate.parse("2026-03-01")!;
    const afterDst = CalendarDate.parse("2026-07-01")!;

    expect(
      beforeDst
        .atWallClock(WallClockTime.of(12, 0), "America/New_York")
        .toISOString()
    ).toBe("2026-03-01T17:00:00.000Z");
    expect(
      afterDst
        .atWallClock(WallClockTime.of(12, 0), "America/New_York")
        .toISOString()
    ).toBe("2026-07-01T16:00:00.000Z");
  });

  it("does not throw on a wall clock time skipped by a daylight saving jump", () => {
    const springForward = CalendarDate.parse("2026-03-08")!;

    const instant = springForward.atWallClock(
      WallClockTime.of(2, 30),
      "America/New_York"
    );

    expect(Number.isNaN(instant.getTime())).toBe(false);
    expect(instant.toISOString()).toBe("2026-03-08T06:30:00.000Z");
    expect(
      new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/New_York",
      }).format(instant)
    ).toBe("08/03/2026");
  });

  it("is independent of the process time zone", () => {
    expect(process.env.TZ).toBe("UTC");

    const date = CalendarDate.parse("2026-07-10")!;

    expect(
      date.atWallClock(WallClockTime.of(14, 0), "America/Sao_Paulo").getTime()
    ).toBe(Date.UTC(2026, 6, 10, 17, 0));
  });
});

describe("WallClockTime", () => {
  it("parses HH:MM", () => {
    const time = WallClockTime.parse("14:30");

    expect(time?.hour).toBe(14);
    expect(time?.minute).toBe(30);
    expect(time?.toString()).toBe("14:30");
  });

  it("rejects out-of-range and malformed values", () => {
    expect(WallClockTime.parse("24:00")).toBeNull();
    expect(WallClockTime.parse("14:60")).toBeNull();
    expect(WallClockTime.parse("4:00")).toBeNull();
    expect(WallClockTime.parse("14:00:00")).toBeNull();
    expect(WallClockTime.parse("")).toBeNull();
  });

  it("exposes midnight", () => {
    expect(WallClockTime.MIDNIGHT.hour).toBe(0);
    expect(WallClockTime.MIDNIGHT.minute).toBe(0);
  });
});
