import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../core/domain/entity/base_entity";
import { z } from "zod";
import {
  DEFAULT_LOCALE,
  DEFAULT_TIME_ZONE,
  localeSchema,
  timeZoneSchema,
  type Locale,
} from "../../../core/domain/locale/locale";

export type UserRole = "user" | "admin";

/** Single source of truth for "what a valid password looks like" (R13) — reused by registration, change, and reset. */
export const passwordSchema = z.string().min(8).max(128);

export const userSchema = baseEntitySchema.extend({
  name: z.string().min(1).max(100),
  email: z.string().email().max(255),
  password: passwordSchema,
  role: z.enum(["user", "admin"]).optional().default("user"),
  locale: localeSchema.optional().default(DEFAULT_LOCALE),
  time_zone: timeZoneSchema.optional().default(DEFAULT_TIME_ZONE),
});

export type UserData = z.infer<typeof userSchema>;
type UserInputData = z.input<typeof userSchema>;

/**
 * @kind Entity
 */
export class User {
  readonly #data: UserData;

  private constructor(data: UserData) {
    this.#data = userSchema.parse(data);
  }

  private static nextId(): string {
    return crypto.randomUUID();
  }

  public static create(data: WithoutBaseEntity<UserInputData>): User {
    return new User({
      ...data,
      id: this.nextId(),
      created_at: new Date(),
      updated_at: new Date(),
    } as UserData);
  }

  public static reconstitute(data: UserData): User {
    return new User(data);
  }

  /** Troca de senha (R10/R12) — recebe o hash já calculado; hashing é responsabilidade de `Hasher`, em `application`. */
  public changePassword(newPasswordHash: string): void {
    this.#data.password = newPasswordHash;
    this.#data.updated_at = new Date();
  }

  /** Restrito a idioma e fuso (R10/R12) — nunca um setter genérico, para que `role` e `email` não virem vetor de mass assignment. */
  public changePreferences(input: { locale: Locale; time_zone: string }): void {
    this.#data.locale = localeSchema.parse(input.locale);
    this.#data.time_zone = timeZoneSchema.parse(input.time_zone);
    this.#data.updated_at = new Date();
  }

  get id() {
    return this.#data.id;
  }

  get name() {
    return this.#data.name;
  }

  get email() {
    return this.#data.email;
  }

  get password() {
    return this.#data.password;
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

  get role(): UserRole {
    return this.#data.role;
  }

  get locale(): Locale {
    return this.#data.locale;
  }

  get time_zone(): string {
    return this.#data.time_zone;
  }
}
