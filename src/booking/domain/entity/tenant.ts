import { z } from "zod";
import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../core/domain/entity/base_entity";

export const tenantSexSchema = z.enum(["MALE", "FEMALE", "OTHER"]);

export type TenantSex = z.infer<typeof tenantSexSchema>;

export const tenantSchema = baseEntitySchema.extend({
  owner_id: z.uuid(),
  name: z.string().min(3).max(100),
  phone: z
    .string()
    .regex(/^[0-9]+$/, "Phone must contain only numbers")
    .min(10)
    .max(15),
  sex: tenantSexSchema,
});

export type TenantData = z.infer<typeof tenantSchema>;

/**
 * @kind Entity, Aggregate Root
 */
export class Tenant {
  readonly #data: TenantData;

  private constructor(data: TenantData) {
    this.#data = tenantSchema.parse(data);
  }
  private static nextId(): string {
    return crypto.randomUUID();
  }

  public static create(data: WithoutBaseEntity<TenantData>): Tenant {
    return new Tenant({
      ...data,
      id: this.nextId(),
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  public static reconstitute(data: TenantData): Tenant {
    return new Tenant(data);
  }

  get id() {
    return this.#data.id;
  }

  get owner_id() {
    return this.#data.owner_id;
  }

  get name() {
    return this.#data.name;
  }

  get phone() {
    return this.#data.phone;
  }

  get sex() {
    return this.#data.sex;
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
