const WALL_CLOCK_TIME_PATTERN = /^(\d{2}):(\d{2})$/;

export class WallClockTime {
  private constructor(
    private readonly _hour: number,
    private readonly _minute: number
  ) {}

  static readonly MIDNIGHT = new WallClockTime(0, 0);

  public static of(hour: number, minute: number): WallClockTime {
    if (
      !Number.isInteger(hour) ||
      !Number.isInteger(minute) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      throw new RangeError(`Invalid wall clock time: ${hour}:${minute}`);
    }

    return new WallClockTime(hour, minute);
  }

  public static parse(value: string): WallClockTime | null {
    const match = WALL_CLOCK_TIME_PATTERN.exec(value.trim());

    if (!match) return null;

    const hour = Number(match[1]);
    const minute = Number(match[2]);

    if (hour > 23 || minute > 59) return null;

    return new WallClockTime(hour, minute);
  }

  get hour(): number {
    return this._hour;
  }

  get minute(): number {
    return this._minute;
  }

  public toString(): string {
    const hour = String(this._hour).padStart(2, "0");
    const minute = String(this._minute).padStart(2, "0");
    return `${hour}:${minute}`;
  }
}
