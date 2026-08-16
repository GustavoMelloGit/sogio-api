import z from "zod";
import {
  baseEntitySchema,
  type SafeUpdateEntity,
  type WithoutBaseEntity,
} from "../../../core/domain/entity/base_entity";
import { Address } from "../value_object/address";
import type { DeepPartial } from "../../../core/application/types/deep_partial";

export const propertySchema = baseEntitySchema.extend({
  name: z.string().min(1, "Name is required").max(100),
  user_id: z.uuidv4("User ID is required and must be a valid UUID"),
  address: z.object({
    street: z.string().min(1, "Street is required").max(100),
    number: z.string().min(1, "Number is required").max(20),
    neighborhood: z.string().min(1, "Neighborhood is required").max(100),
    city: z.string().min(1, "City is required").max(100),
    state: z.string().min(1, "State is required").max(100),
    zip_code: z.string().min(1, "Zip code is required").max(20),
    country: z.string().min(1, "Country is required").max(100),
    complement: z.string().max(100).default(""),
  }),
  images: z.array(z.string().max(2048)).min(1, "Images are required"),
  capacity: z.number().int().positive("Capacity must be greater than 0"),
});

export type PropertyData = z.infer<typeof propertySchema>;

/**
 * @kind Entity, Aggregate Root
 */
export class Property {
  readonly id: string;
  #name: string;
  #user_id: string;
  #address: Address;
  #images: string[];
  #capacity: number;
  #created_at: Date;
  #updated_at: Date;
  #deleted_at: Date | null | undefined;

  private constructor(data: PropertyData) {
    this.id = data.id;
    this.#name = data.name;
    this.#user_id = data.user_id;
    this.#address = Address.create(data.address);
    this.#images = data.images;
    this.#capacity = data.capacity;
    this.#created_at = data.created_at;
    this.#updated_at = data.updated_at;
    this.#deleted_at = data.deleted_at;
  }

  private static nextId(): string {
    return crypto.randomUUID();
  }

  public static create(data: WithoutBaseEntity<PropertyData>): Property {
    return new Property({
      ...data,
      id: this.nextId(),
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  public static reconstitute(data: PropertyData): Property {
    return new Property(data);
  }

  public changeDetails(
    data: DeepPartial<SafeUpdateEntity<PropertyData>>
  ): void {
    const safeData = propertySchema.partial().parse(data);

    this.#name = safeData.name ?? this.#name;
    this.#images = safeData.images ?? this.#images;
    this.#capacity = safeData.capacity ?? this.#capacity;

    if (safeData.address) {
      this.#address = Address.create(safeData.address);
    }

    this.#updated_at = new Date();
  }

  /**
   * Marks the property as deleted. Deliberately does not throw on repeated
   * calls, unlike `Stay.cancel()` — `PropertyOwnershipPolicy` already turns a
   * deleted property into 404 before this can run twice.
   */
  public softDelete(): void {
    this.#deleted_at = new Date();
    this.#updated_at = new Date();
  }

  get name() {
    return this.#name;
  }

  get user_id() {
    return this.#user_id;
  }

  get address() {
    return this.#address;
  }

  get images() {
    return this.#images;
  }

  get capacity() {
    return this.#capacity;
  }

  get created_at() {
    return this.#created_at;
  }

  get updated_at() {
    return this.#updated_at;
  }

  get deleted_at() {
    return this.#deleted_at;
  }

  get data(): PropertyData {
    return {
      id: this.id,
      name: this.name,
      user_id: this.user_id,
      address: this.address.data,
      images: this.images,
      capacity: this.capacity,
      created_at: this.created_at,
      updated_at: this.updated_at,
      deleted_at: this.deleted_at,
    };
  }
}
