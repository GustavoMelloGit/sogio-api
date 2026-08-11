import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../../core/domain/entity/base_entity";
import { z } from "zod";

export const authorizationCodeSchema = baseEntitySchema.extend({
  code_digest: z.string().length(64),
  app_registration_id: z.uuidv4(),
  consent_id: z.uuidv4(),
  redirect_uri: z.string().min(1).max(2048),
  code_challenge: z.string().min(1).max(255),
  code_challenge_method: z.literal("S256"),
  scope: z.string().min(1).max(255),
  resource: z.string().min(1).max(512),
  expires_at: z.date(),
  consumed_at: z.date().nullable().optional(),
});

export type AuthorizationCodeData = z.infer<typeof authorizationCodeSchema>;
type AuthorizationCodeInputData = z.input<typeof authorizationCodeSchema>;

/**
 * @kind Entity
 *
 * Código de Autorização — comprovante de uso único e vida curtíssima de que
 * o consentimento aconteceu. `redirect_uri` e `app_registration_id` são
 * revalidados na troca por credenciais (E3): o código emitido para um
 * aplicativo não é trocável por outro.
 */
export class AuthorizationCode {
  readonly #data: AuthorizationCodeData;

  private constructor(data: AuthorizationCodeData) {
    this.#data = authorizationCodeSchema.parse(data);
  }

  private static nextId(): string {
    return crypto.randomUUID();
  }

  public static create(
    data: WithoutBaseEntity<AuthorizationCodeInputData>
  ): AuthorizationCode {
    return new AuthorizationCode({
      ...data,
      id: this.nextId(),
      created_at: new Date(),
      updated_at: new Date(),
    } as AuthorizationCodeData);
  }

  public static reconstitute(data: AuthorizationCodeData): AuthorizationCode {
    return new AuthorizationCode(data);
  }

  get id() {
    return this.#data.id;
  }

  get code_digest() {
    return this.#data.code_digest;
  }

  get app_registration_id() {
    return this.#data.app_registration_id;
  }

  get consent_id() {
    return this.#data.consent_id;
  }

  get redirect_uri() {
    return this.#data.redirect_uri;
  }

  get code_challenge() {
    return this.#data.code_challenge;
  }

  get code_challenge_method() {
    return this.#data.code_challenge_method;
  }

  get scope() {
    return this.#data.scope;
  }

  get resource() {
    return this.#data.resource;
  }

  get expires_at() {
    return this.#data.expires_at;
  }

  get consumed_at() {
    return this.#data.consumed_at;
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
