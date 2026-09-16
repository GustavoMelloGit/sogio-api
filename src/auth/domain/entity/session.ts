import { z } from "zod";
import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../core/domain/entity/base_entity";

export const sessionSchema = baseEntitySchema.extend({
  user_id: z.uuidv4(),
  secret_digest: z.string().length(64),
  expires_at: z.date(),
  last_used_at: z.date(),
  revoked_at: z.date().nullable().optional(),
});

export type SessionData = z.infer<typeof sessionSchema>;
type SessionInputData = z.input<typeof sessionSchema>;

export class Session {
  readonly #data: SessionData;

  private constructor(data: SessionData) {
    this.#data = sessionSchema.parse(data);
  }

  private static nextId(): string {
    return crypto.randomUUID();
  }

  public static create(data: WithoutBaseEntity<SessionInputData>): Session {
    return new Session({
      ...data,
      id: this.nextId(),
      created_at: new Date(),
      updated_at: new Date(),
    } as SessionData);
  }

  public static reconstitute(data: SessionData): Session {
    return new Session(data);
  }

  public isValid(now: Date, inactivityTtlMs: number): boolean {
    if (this.#data.revoked_at || this.#data.deleted_at) {
      return false;
    }

    if (this.#data.expires_at.getTime() <= now.getTime()) {
      return false;
    }

    return now.getTime() - this.#data.last_used_at.getTime() < inactivityTtlMs;
  }

  get id() {
    return this.#data.id;
  }

  get user_id() {
    return this.#data.user_id;
  }

  get secret_digest() {
    return this.#data.secret_digest;
  }

  get expires_at() {
    return this.#data.expires_at;
  }

  get last_used_at() {
    return this.#data.last_used_at;
  }

  get revoked_at() {
    return this.#data.revoked_at;
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
