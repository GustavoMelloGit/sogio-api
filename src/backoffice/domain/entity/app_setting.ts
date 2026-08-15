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

/**
 * Security invariant: AppSetting must NOT store secrets, credentials, or PII.
 * This entity is intended for application configuration (feature flags, UI settings, etc.)
 * only. Sensitive values must be managed via environment variables or a secrets manager.
 */

export { boundedJsonValue };

export const appSettingTypeSchema = settingTypeSchema;

export type AppSettingType = SettingType;

export const appSettingSchema = baseEntitySchema
  .extend({
    key: settingKeySchema,
    value: boundedJsonValue,
    type: appSettingTypeSchema,
    description: settingDescriptionSchema,
  })
  .superRefine((data, ctx) => refineSettingValueForType(data, ctx));

export type AppSettingData = z.infer<typeof appSettingSchema>;

/**
 * @kind Entity, Aggregate Root
 * @bc backoffice
 *
 * Security note: do NOT store secrets, credentials, or PII in this entity.
 */
export class AppSetting {
  readonly #data: AppSettingData;

  private constructor(data: AppSettingData) {
    const result = appSettingSchema.safeParse(data);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? "Invalid app setting";
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

  public static reconstitute(data: AppSettingData): AppSetting {
    return new AppSetting(data);
  }

  public static create(data: WithoutBaseEntity<AppSettingData>): AppSetting {
    const normalizedKey = data.key.trim();
    return new AppSetting({
      ...data,
      key: normalizedKey,
      ...this.#baseEntityData(),
    });
  }

  /**
   * Returns a new AppSetting with the applied patch.
   * `key` is immutable and cannot be changed.
   */
  public update(patch: {
    value?: unknown;
    type?: AppSettingType;
    description?: string | null;
  }): AppSetting {
    return new AppSetting({
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
   * Returns a new AppSetting marked as deleted (soft delete).
   */
  public softDelete(): AppSetting {
    return new AppSetting({
      ...this.#data,
      deleted_at: new Date(),
      updated_at: new Date(),
    });
  }

  get id() {
    return this.#data.id;
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
