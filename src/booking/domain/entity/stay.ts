import { IllegalStateError } from "../../../core/application/error/illegal_state_error";
import { ValidationError } from "../../../core/application/error/validation_error";
import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../core/domain/entity/base_entity";
import { z } from "zod";
import { MAX_PROPERTY_CAPACITY } from "../../../property_management/domain/entity/property";

export const MAX_STAY_PRICE_IN_CENTS = 100_000_000;

export const staySchema = baseEntitySchema.extend({
  check_in: z.date(),
  check_out: z.date(),
  tenant_id: z.uuidv4(),
  property_id: z.uuidv4(),
  guests: z.number().int().positive().max(MAX_PROPERTY_CAPACITY),
  entrance_code: z.string().max(10),
  price: z.number().int().nonnegative().max(MAX_STAY_PRICE_IN_CENTS),
  source: z.string().max(100),
});

export type StayData = z.infer<typeof staySchema>;

/**
 * @kind Entity
 */
export class Stay {
  readonly #data: StayData;

  private constructor(data: StayData) {
    this.#data = staySchema.parse(data);
  }

  private static nextId(): string {
    return crypto.randomUUID();
  }

  public static create(data: WithoutBaseEntity<StayData>): Stay {
    if (data.check_in >= data.check_out) {
      throw new ValidationError("Check-in date must be before check-out date");
    }

    return new Stay({
      ...data,
      id: this.nextId(),
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  public static reconstitute(data: StayData): Stay {
    return new Stay(data);
  }

  public cancel(): void {
    if (this.deleted_at) {
      throw new IllegalStateError("Stay has already been cancelled");
    }

    if (this.check_in <= new Date()) {
      throw new IllegalStateError(
        "Cannot cancel a stay that has already started"
      );
    }

    this.#data.deleted_at = new Date();
    this.#data.updated_at = new Date();
  }

  public update(data: Partial<WithoutBaseEntity<StayData>>): void {
    if (this.deleted_at) {
      throw new IllegalStateError("Cannot update a cancelled stay");
    }

    const updatedData = { ...this.#data, ...data };

    if (updatedData.check_in >= updatedData.check_out) {
      throw new ValidationError("Check-in date must be before check-out date");
    }

    Object.assign(this.#data, updatedData);
    this.#data.updated_at = new Date();
  }

  get id() {
    return this.#data.id;
  }

  get check_in() {
    return this.#data.check_in;
  }

  get check_out() {
    return this.#data.check_out;
  }

  get tenant_id() {
    return this.#data.tenant_id;
  }

  get property_id() {
    return this.#data.property_id;
  }

  get guests() {
    return this.#data.guests;
  }

  get entrance_code() {
    return this.#data.entrance_code;
  }

  get price() {
    return this.#data.price;
  }

  get source() {
    return this.#data.source;
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

  get data(): StayData {
    return this.#data;
  }
}
