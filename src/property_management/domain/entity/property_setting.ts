import { z } from "zod";
import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../core/domain/entity/base_entity";
import { ValidationError } from "../../../core/application/error/validation_error";
import {
  boundedJsonValue,
  refineSettingValueForType,
  settingDescriptionSchema,
  settingKeySchema,
  settingTypeSchema,
  type SettingType,
} from "../../../core/domain/value_object/setting_value";

export type PropertySettingType = SettingType;

export const propertySettingSchema = baseEntitySchema
  .extend({
    property_id: z.uuidv4("Property ID is required and must be a valid UUID"),
    key: settingKeySchema,
    value: boundedJsonValue,
    type: settingTypeSchema,
    description: settingDescriptionSchema,
  })
  .superRefine((data, ctx) => {
    // A soft-deleted setting has its `value`/`description` redacted (see
    // `softDelete()`) and no longer needs to satisfy the original type's
    // coherence rule — the redacted value is intentionally type-agnostic.
    if (data.deleted_at) return;
    refineSettingValueForType(data, ctx);
  });

export type PropertySettingData = z.infer<typeof propertySettingSchema>;

/**
 * @kind Entity, Aggregate Root
 * @bc property_management
 *
 * `PropertySetting` is its own aggregate, referencing `Property` only by
 * `property_id` — it is not a value object nested inside the `Property`
 * aggregate, and creating/reading/updating it never loads or mutates
 * `Property` itself beyond the ownership check.
 *
 * Security invariant: PropertySetting must NOT store secrets, credentials,
 * or PII. This is a generic, extensible key/value store for property
 * configuration (e.g. check-in instructions, display preferences) — it is
 * NOT a secrets manager. In particular, never use it to store smart lock
 * access codes/credentials or API tokens/secrets for external booking
 * platform integrations (Airbnb, Booking.com, etc.); those belong in a
 * dedicated secrets manager or encrypted store.
 */
export class PropertySetting {
  readonly #data: PropertySettingData;

  private constructor(data: PropertySettingData) {
    const result = propertySettingSchema.safeParse(data);
    if (!result.success) {
      const message =
        result.error.issues[0]?.message ?? "Invalid property setting";
      throw new ValidationError(message);
    }
    this.#data = result.data;
  }

  static #nextId(): string {
    return crypto.randomUUID();
  }

  static #baseEntityData() {
    return {
      id: this.#nextId(),
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  public static reconstitute(data: PropertySettingData): PropertySetting {
    return new PropertySetting(data);
  }

  public static create(
    data: WithoutBaseEntity<PropertySettingData>
  ): PropertySetting {
    const normalizedKey = data.key.trim();
    return new PropertySetting({
      ...data,
      key: normalizedKey,
      ...this.#baseEntityData(),
    });
  }

  /**
   * Returns a new PropertySetting with the applied patch.
   * `key` and `property_id` are immutable and cannot be changed.
   */
  public update(patch: {
    value?: unknown;
    type?: PropertySettingType;
    description?: string | null;
  }): PropertySetting {
    return new PropertySetting({
      ...this.#data,
      value: patch.value !== undefined ? patch.value : this.#data.value,
      type: patch.type !== undefined ? patch.type : this.#data.type,
      description:
        patch.description !== undefined
          ? patch.description
          : this.#data.description,
      updated_at: new Date(),
    });
  }

  /**
   * Returns a new PropertySetting marked as deleted (soft delete). The row
   * itself is kept — for audit and to back the partial unique index on
   * `(property_id, key)` — but `value` and `description` are redacted so a
   * soft-deleted setting doesn't retain its content indefinitely.
   */
  public softDelete(): PropertySetting {
    return new PropertySetting({
      ...this.#data,
      value: null,
      description: null,
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

  get key() {
    return this.#data.key;
  }

  get value() {
    return this.#data.value;
  }

  get type() {
    return this.#data.type;
  }

  get description() {
    return this.#data.description ?? null;
  }

  get created_at() {
    return this.#data.created_at;
  }

  get updated_at() {
    return this.#data.updated_at;
  }

  get deleted_at() {
    return this.#data.deleted_at ?? null;
  }
}
