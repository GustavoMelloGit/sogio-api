import type { PropertySetting } from "../entity/property_setting";
import type {
  PaginatedResult,
  PaginationInput,
} from "../../../core/application/dto/pagination";

export interface PropertySettingRepository {
  /**
   * Persists a new setting, atomically enforcing `maxActiveSettings` against
   * the property's current active count. Callers must not count-then-save
   * themselves (TOCTOU): the count check and the insert have to happen under
   * the same lock, which only the repository can guarantee.
   */
  save(setting: PropertySetting, maxActiveSettings: number): Promise<void>;
  update(setting: PropertySetting): Promise<void>;
  findById(id: string): Promise<PropertySetting | null>;
  findByKey(key: string, propertyId: string): Promise<PropertySetting | null>;
  list(
    propertyId: string,
    pagination: PaginationInput
  ): Promise<PaginatedResult<PropertySetting>>;
  delete(setting: PropertySetting): Promise<void>;
}
