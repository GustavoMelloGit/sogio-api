import type { Logger } from "../../../core/application/logger/logger";
import { WallClockTime } from "../../../core/domain/calendar/wall_clock_time";
import {
  CHECK_IN_TIME_SETTING_KEY,
  CHECK_OUT_TIME_SETTING_KEY,
  DEFAULT_CHECK_IN_TIME,
  DEFAULT_CHECK_OUT_TIME,
  PropertyCheckTimes,
} from "../../domain/service/property_check_times";
import type { PropertySettingRepository } from "../../domain/repository/property_setting_repository";
import type { PropertyCheckTimesService } from "./property_check_times_service";

export class SettingPropertyCheckTimesService
  implements PropertyCheckTimesService
{
  constructor(
    private readonly propertySettingRepository: PropertySettingRepository,
    private readonly logger: Logger
  ) {}

  async checkTimesOf(property_id: string): Promise<PropertyCheckTimes> {
    const [checkIn, checkOut] = await Promise.all([
      this.#timeOfSetting(
        property_id,
        CHECK_IN_TIME_SETTING_KEY,
        DEFAULT_CHECK_IN_TIME
      ),
      this.#timeOfSetting(
        property_id,
        CHECK_OUT_TIME_SETTING_KEY,
        DEFAULT_CHECK_OUT_TIME
      ),
    ]);

    return PropertyCheckTimes.of(checkIn, checkOut);
  }

  async #timeOfSetting(
    property_id: string,
    key: string,
    fallback: WallClockTime
  ): Promise<WallClockTime> {
    const setting = await this.propertySettingRepository.findByKey(
      key,
      property_id
    );

    if (!setting) return fallback;

    const raw = setting.value;

    if (typeof raw !== "string") {
      this.logger.warn("Property check time setting is not a string", {
        property_id,
        key,
        fallback: fallback.toString(),
      });
      return fallback;
    }

    const parsed = WallClockTime.parse(raw);

    if (!parsed) {
      this.logger.warn("Property check time setting is not a valid HH:MM", {
        property_id,
        key,
        fallback: fallback.toString(),
      });
      return fallback;
    }

    return parsed;
  }
}
