import { WallClockTime } from "../../../core/domain/calendar/wall_clock_time";

export const CHECK_IN_TIME_SETTING_KEY = "check_in_time";
export const CHECK_OUT_TIME_SETTING_KEY = "check_out_time";

export const DEFAULT_CHECK_IN_TIME = WallClockTime.of(14, 0);
export const DEFAULT_CHECK_OUT_TIME = WallClockTime.of(11, 0);

export class PropertyCheckTimes {
  private constructor(
    private readonly _check_in: WallClockTime,
    private readonly _check_out: WallClockTime
  ) {}

  public static of(
    check_in: WallClockTime,
    check_out: WallClockTime
  ): PropertyCheckTimes {
    return new PropertyCheckTimes(check_in, check_out);
  }

  public static default(): PropertyCheckTimes {
    return new PropertyCheckTimes(
      DEFAULT_CHECK_IN_TIME,
      DEFAULT_CHECK_OUT_TIME
    );
  }

  get check_in(): WallClockTime {
    return this._check_in;
  }

  get check_out(): WallClockTime {
    return this._check_out;
  }
}
