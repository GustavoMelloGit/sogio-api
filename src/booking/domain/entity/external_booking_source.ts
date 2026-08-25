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
