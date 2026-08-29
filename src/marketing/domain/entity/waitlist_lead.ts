import { z } from "zod";
import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../core/domain/entity/base_entity";

export const PROPERTY_COUNT_RANGES = ["1", "2-3", "4-10", "10+"] as const;

export type PropertyCountRange = (typeof PROPERTY_COUNT_RANGES)[number];

export const DEFAULT_WAITLIST_SOURCE = "landing";

export const waitlistLeadSchema = baseEntitySchema.extend({
  name: z.string().min(2).max(255),
  whatsapp: z
    .string()
    .max(15)
    .regex(
      /^[0-9]{10,11}$/,
      "whatsapp must have 10 or 11 digits, area code included"
    ),
  property_count: z.enum(PROPERTY_COUNT_RANGES),
  source: z.string().min(1).max(50),
  consented_at: z.date(),
});

export type WaitlistLeadData = z.infer<typeof waitlistLeadSchema>;

/**
 * @kind Entity
 */
export class WaitlistLead {
  readonly #data: WaitlistLeadData;

  private constructor(data: WaitlistLeadData) {
    this.#data = waitlistLeadSchema.parse(data);
  }

  static #nextId(): string {
    return crypto.randomUUID();
  }

  public static create(
    data: WithoutBaseEntity<WaitlistLeadData>
  ): WaitlistLead {
    return new WaitlistLead({
      ...data,
      name: this.#normalizeName(data.name),
      whatsapp: this.#normalizeWhatsapp(data.whatsapp),
      source: this.#normalizeSource(data.source),
      id: this.#nextId(),
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  public static reconstitute(data: WaitlistLeadData): WaitlistLead {
    return new WaitlistLead(data);
  }

  static #normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, " ");
  }

  static #normalizeWhatsapp(whatsapp: string): string {
    return whatsapp.replace(/[^0-9]/g, "");
  }

  static #normalizeSource(source: string): string {
    const normalized = source.trim().toLowerCase();
    return normalized.length > 0 ? normalized : DEFAULT_WAITLIST_SOURCE;
  }

  get id() {
    return this.#data.id;
  }

  get name() {
    return this.#data.name;
  }

  get whatsapp() {
    return this.#data.whatsapp;
  }

  get property_count() {
    return this.#data.property_count;
  }

  get source() {
    return this.#data.source;
  }

  get consented_at() {
    return this.#data.consented_at;
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
