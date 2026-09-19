import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../core/domain/entity/base_entity";
import { z } from "zod";

export type ExternalBookingSourcePlatformName = string;

export const KNOWN_EXTERNAL_BOOKING_PLATFORMS: readonly string[] = [
  "AIRBNB",
  "BOOKING",
  "VRBO",
  "EXPEDIA",
  "AGODA",
  "TRIPADVISOR",
  "DESPEGAR",
  "HOSTELWORLD",
];

export const externalBookingSourceSchema = baseEntitySchema.extend({
  property_id: z.uuidv4(),
  platform_name: z
    .string()
    .max(50)
    .regex(/^[A-Z0-9_]{2,50}$/),
  sync_url: z.url().max(2048),
});

export type ExternalBookingSourceData = z.infer<
  typeof externalBookingSourceSchema
>;

/**
 * @kind Entity
 */
export class ExternalBookingSource {
  readonly #data: ExternalBookingSourceData;

  private constructor(data: ExternalBookingSourceData) {
    this.#data = externalBookingSourceSchema.parse(data);
  }

  static #nextId(): string {
    return crypto.randomUUID();
  }

  public static create(
    data: WithoutBaseEntity<ExternalBookingSourceData>
  ): ExternalBookingSource {
    return new ExternalBookingSource({
      ...data,
      platform_name: this.#normalizePlatformName(data.platform_name),
      id: this.#nextId(),
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  public static reconstitute(
    data: ExternalBookingSourceData
  ): ExternalBookingSource {
    return new ExternalBookingSource(data);
  }

  static #normalizePlatformName(platformName: string): string {
    return platformName
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_");
  }

  /**
   * Returns a new source with the patched fields. `property_id` is absent
   * from the patch on purpose: moving a calendar to another property is
   * registering a different calendar, not editing this one — the same
   * discipline that keeps `PropertySetting.key` immutable.
   *
   * `platform_name` goes through the same normalization `create()` applies,
   * so a value written by an edit is indistinguishable from one written at
   * creation.
   */
  public update(patch: {
    platform_name?: string;
    sync_url?: string;
  }): ExternalBookingSource {
    return new ExternalBookingSource({
      ...this.#data,
      platform_name:
        patch.platform_name !== undefined
          ? ExternalBookingSource.#normalizePlatformName(patch.platform_name)
          : this.#data.platform_name,
      sync_url:
        patch.sync_url !== undefined ? patch.sync_url : this.#data.sync_url,
      updated_at: new Date(),
    });
  }

  /**
   * Returns a new source marked as deleted (soft delete). The row is kept,
   * but every read filters `deleted_at`, so a removed calendar stops being
   * synced by `ReconcileExternalBookingsUseCase`.
   *
   * Unlike `PropertySetting.softDelete()`, `sync_url` is NOT redacted here:
   * the column is `notNull`, so redacting it would need a migration. That is
   * a known, accepted gap (R-1 in
   * `.claude/plans/2026-09-19-crud-de-calendarios-externos.md`) — an iCal URL
   * carries its own access token, so a removed row keeps a live capability
   * URL until that migration happens.
   */
  public softDelete(): ExternalBookingSource {
    return new ExternalBookingSource({
      ...this.#data,
      deleted_at: new Date(),
      updated_at: new Date(),
    });
  }

  get id() {
    return this.#data.id;
  }

  get property_id() {
    return this.#data.property_id;
  }

  get platform_name() {
    return this.#data.platform_name;
  }

  get sync_url() {
    return this.#data.sync_url;
  }

  get created_at() {
    return this.#data.created_at;
  }

  get updated_at() {
    return this.#data.updated_at;
  }

  get deleted_at() {
    return this.#data.deleted_at;
  }
}
