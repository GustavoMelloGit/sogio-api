import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../core/domain/entity/base_entity";
import { z } from "zod";

export const IDENTITY_PROVIDERS = ["google"] as const;
export type IdentityProvider = (typeof IDENTITY_PROVIDERS)[number];

export const linkedIdentitySchema = baseEntitySchema.extend({
  user_id: z.uuidv4(),
  provider: z.enum(IDENTITY_PROVIDERS),
  subject: z.string().min(1).max(255),
});

export type LinkedIdentityData = z.infer<typeof linkedIdentitySchema>;
type LinkedIdentityInputData = z.input<typeof linkedIdentitySchema>;

export class LinkedIdentity {
  readonly #data: LinkedIdentityData;

  private constructor(data: LinkedIdentityData) {
    this.#data = linkedIdentitySchema.parse(data);
  }

  private static nextId(): string {
    return crypto.randomUUID();
  }

  public static create(
    data: WithoutBaseEntity<LinkedIdentityInputData>
  ): LinkedIdentity {
    return new LinkedIdentity({
      ...data,
      id: this.nextId(),
      created_at: new Date(),
      updated_at: new Date(),
    } as LinkedIdentityData);
  }

  public static reconstitute(data: LinkedIdentityData): LinkedIdentity {
    return new LinkedIdentity(data);
  }

  get id() {
    return this.#data.id;
  }

  get user_id() {
    return this.#data.user_id;
  }

  get provider() {
    return this.#data.provider;
  }

  get subject() {
    return this.#data.subject;
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
