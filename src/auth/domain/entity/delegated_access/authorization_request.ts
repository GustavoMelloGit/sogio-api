import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../../core/domain/entity/base_entity";
import { z } from "zod";

export const authorizationRequestSchema = baseEntitySchema.extend({
  identifier_digest: z.string().length(64),
  app_registration_id: z.uuidv4(),
  redirect_uri: z.string().min(1).max(2048),
  code_challenge: z.string().min(1).max(255),
  code_challenge_method: z.literal("S256"),
  scope: z.string().min(1).max(255),
  resource: z.string().min(1).max(512),
  state: z.string().max(512).nullable().optional(),
  expires_at: z.date(),
  consumed_at: z.date().nullable().optional(),
});

export type AuthorizationRequestData = z.infer<
  typeof authorizationRequestSchema
>;
type AuthorizationRequestInputData = z.input<typeof authorizationRequestSchema>;

/**
 * @kind Entity
 *
 * Pedido de Autorização — intenção pendente de um aplicativo, aguardando a
 * decisão do usuário. Efêmero, com TTL e uso único: a reivindicação
 * (consumed_at) é sempre uma instrução atômica no banco, nunca leitura
 * seguida de escrita.
 */
export class AuthorizationRequest {
  readonly #data: AuthorizationRequestData;

  private constructor(data: AuthorizationRequestData) {
    this.#data = authorizationRequestSchema.parse(data);
  }

  private static nextId(): string {
    return crypto.randomUUID();
  }

  public static create(
    data: WithoutBaseEntity<AuthorizationRequestInputData>
  ): AuthorizationRequest {
    return new AuthorizationRequest({
      ...data,
      id: this.nextId(),
      created_at: new Date(),
      updated_at: new Date(),
    } as AuthorizationRequestData);
  }

  public static reconstitute(
    data: AuthorizationRequestData
  ): AuthorizationRequest {
    return new AuthorizationRequest(data);
  }

  get id() {
    return this.#data.id;
  }

  get identifier_digest() {
    return this.#data.identifier_digest;
  }

  get app_registration_id() {
    return this.#data.app_registration_id;
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

  get state() {
    return this.#data.state;
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
