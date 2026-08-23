import type { WallClockTime } from "./wall_clock_time";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const BR_DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function utcMilliseconds(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, 0, 0);
  return date.getTime();
}

const OFFSET_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = OFFSET_FORMATTERS.get(timeZone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    OFFSET_FORMATTERS.set(timeZone, formatter);
  }

  return formatter;
}

function zoneOffsetAt(instant: number, timeZone: string): number {
  const parts = offsetFormatter(timeZone).formatToParts(new Date(instant));
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find(part => part.type === type)?.value ?? "0");

  const localAsUtc = utcMilliseconds(
    read("year"),
    read("month"),
    read("day"),
    read("hour"),
    read("minute")
  );

  return localAsUtc - Math.floor(instant / 60_000) * 60_000;
}

export class CalendarDate {
  private constructor(
    private readonly _year: number,
    private readonly _month: number,
    private readonly _day: number
  ) {}

  public static parse(value: string): CalendarDate | null {
    const trimmed = value.trim();
    const iso = ISO_DATE_PATTERN.exec(trimmed);

    if (iso) {
      return CalendarDate.of(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    }

    const brazilian = BR_DATE_PATTERN.exec(trimmed);

    if (brazilian) {
      return CalendarDate.of(
        Number(brazilian[3]),
        Number(brazilian[2]),
        Number(brazilian[1])
      );
    }

    return null;
  }

  public static of(
    year: number,
    month: number,
    day: number
  ): CalendarDate | null {
    const probe = new Date(utcMilliseconds(year, month, day, 0, 0));

    const isValid =
      probe.getUTCFullYear() === year &&
      probe.getUTCMonth() === month - 1 &&
      probe.getUTCDate() === day;

    return isValid ? new CalendarDate(year, month, day) : null;
  }

  public atWallClock(time: WallClockTime, timeZone: string): Date {
    const localAsUtc = utcMilliseconds(
      this._year,
      this._month,
      this._day,
      time.hour,
      time.minute
    );

    const firstGuess = localAsUtc - zoneOffsetAt(localAsUtc, timeZone);

    return new Date(localAsUtc - zoneOffsetAt(firstGuess, timeZone));
  }

  public isBefore(other: CalendarDate): boolean {
    return this.comparableValue() < other.comparableValue();
  }

  private comparableValue(): number {
    return this._year * 10_000 + this._month * 100 + this._day;
  }

  get year(): number {
    return this._year;
  }

  get month(): number {
    return this._month;
  }

  get day(): number {
    return this._day;
  }

  public toString(): string {
    const year = String(this._year).padStart(4, "0");
    const month = String(this._month).padStart(2, "0");
    const day = String(this._day).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}
