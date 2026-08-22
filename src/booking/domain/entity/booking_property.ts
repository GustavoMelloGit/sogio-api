import type { BookingPolicy } from "../policy/booking_policy";
import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../core/domain/entity/base_entity";
import { z } from "zod";
import { Stay } from "./stay";
import { ValidationError } from "../../../core/application/error/validation_error";
import { MAX_PROPERTY_CAPACITY } from "../../../property_management/domain/entity/property";

export const bookingPropertySchema = baseEntitySchema.extend({
  name: z.string().min(1, "Name is required").max(100),
  user_id: z.uuidv4("User ID is required and must be a valid UUID"),
  capacity: z
    .int("Capacity is required and must be a positive integer")
    .positive("Capacity must be a positive integer")
    .max(MAX_PROPERTY_CAPACITY),
});

export type BookingPropertyData = z.infer<typeof bookingPropertySchema>;

/**
 * @kind Entity, Aggregate Root
 */
export class BookingProperty {
  readonly id: string;
  #name: string;
  #user_id: string;
  #capacity: number;
  #created_at: Date;
  #updated_at: Date;
  #deleted_at: Date | null | undefined;

  private constructor(data: BookingPropertyData) {
    this.id = data.id;
    this.#name = data.name;
    this.#user_id = data.user_id;
    this.#capacity = data.capacity;
    this.#created_at = data.created_at;
    this.#updated_at = data.updated_at;
    this.#deleted_at = data.deleted_at;
  }

  private static nextId(): string {
    return crypto.randomUUID();
  }

  public static create(
    data: WithoutBaseEntity<BookingPropertyData>
  ): BookingProperty {
    return new BookingProperty({
      ...data,
      id: this.nextId(),
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  public static reconstitute(data: BookingPropertyData): BookingProperty {
    return new BookingProperty(data);
  }

  public async bookStay(
    args: BookStayArgs,
    bookingPolicy: BookingPolicy
  ): Promise<Stay> {
    const { check_in, check_out, guests } = args;

    const invalidNumberOfGuests = guests < 1 || !Number.isInteger(guests);

    if (invalidNumberOfGuests) {
      throw new ValidationError("Invalid guests");
    }

    if (guests > this.capacity) {
      throw new ValidationError("Property capacity exceeded");
    }
    if (check_in >= check_out) {
      throw new ValidationError("Check-in date must be before check-out date");
    }

    await bookingPolicy.isBookingAllowed(this.id, check_in, check_out);

    const stay = Stay.create({
      ...args,
      property_id: this.id,
    });

    return stay;
  }

  get name() {
    return this.#name;
  }

  get user_id() {
    return this.#user_id;
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

  get data(): BookingPropertyData {
    return {
      id: this.id,
      name: this.name,
      user_id: this.user_id,
      capacity: this.capacity,
      created_at: this.created_at,
      updated_at: this.updated_at,
      deleted_at: this.deleted_at,
    };
  }
}

type BookStayArgs = {
  check_in: Date;
  check_out: Date;
  tenant_id: string;
  guests: number;
  entrance_code: string;
  price: number;
  source: string;
};
